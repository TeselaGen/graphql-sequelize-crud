"use strict";

const {
  GraphQLObjectType,
  GraphQLSchema,
  GraphQLInt,
  GraphQLString,
  GraphQLList,
  GraphQLNonNull,
  GraphQLBoolean,
  GraphQLInputObjectType,
  GraphQLID
} = require('graphql');
const _ = require('lodash');
const pluralize = require('pluralize');
const camelcase = require('camelcase');
import condenseAssociations from './condenseAssociations';
const {
  fromGlobalId,
  globalIdField,
  mutationWithClientMutationId
} = require("graphql-relay");

const {
  defaultArgs,
  defaultListArgs,
  attributeFields,
  argsToFindOptions,
  resolver,
  relay: {
    sequelizeNodeInterface,
    sequelizeConnection
  }
} = require("graphql-sequelize-teselagen");

const jsonType = require("graphql-sequelize-teselagen/lib/types/jsonType.js");

function connectionNameForAssociation(Model, associationName) {
  return camelcase(`${Model.name}_${associationName}`);
}
function queryName(Model, type) {
  switch (type) {
    case 'findAll': {
      return camelcase(pluralize.plural(Model.name));
    }
    case 'findById': {
      return camelcase(Model.name);
    }
    default: {
      console.warn('Unknown query type: ',type);
      return camelcase(`${type}_${Model.name}`);
    }
  }
}

function mutationName(Model, type) {
  switch (type) {
    case 'create': {
      return camelcase(`${type}_${pluralize.plural(Model.name)}`);
    }
    case 'createOne': {
      return camelcase(`create_${Model.name}`);
    }
    case 'update': {
      return camelcase(`${type}_${pluralize.plural(Model.name)}`);
    }
    case 'updateOne': {
      return camelcase(`update_${Model.name}`);
    }
    case 'delete': {
      return camelcase(`${type}_${pluralize.plural(Model.name)}`);
    }
    case 'deleteOne': {
      return camelcase(`delete_${Model.name}`);
    }
    default: {
      console.warn('Unknown mutation type: ', type);
      return camelcase(`${type}_${Model.name}`);
    }
  }
}

function convertFieldsToGlobalId(Model, fields) {
  // Fix Relay Global ID
  _.each(Object.keys(Model.rawAttributes), (k) => {
    if (k === "clientMutationId") {
      return;
    }
    // Check if reference attribute
    let attr = Model.rawAttributes[k];
    if (!attr) return
    if (attr.references) {
      // console.log(`Replacing ${Model.name}'s field ${k} with globalIdField.`);
      let modelName = attr.references.model;
      // let modelType = types[modelName];
      fields[k] = globalIdField(modelName);
      fields[k].type = GraphQLID;
    } else if (attr.primaryKey) {
      fields[k] = globalIdField(Model.name);
      // Make primaryKey optional (allowNull=True)
      fields[k].type = GraphQLID;
    }
  });
}

function convertFieldsFromGlobalId(Model, data) {
  // Fix Relay Global ID
  _.each(Object.keys(data), (k) => {
    if (k === "clientMutationId") {
      return;
    }
    // Check if reference attribute
    let attr = Model.rawAttributes[k];
    if (!attr) return
    if (attr.references || attr.primaryKey) {
      let {id} = fromGlobalId(data[k]);

      // Check if id is numeric.
      if(!_.isNaN(_.toNumber(id))) {
          data[k] = parseInt(id);
      } else {
          data[k] = id;
      }
    }
  });
}

function _createRecord({
  mutations,
  Model,
  modelType,
  ModelTypes,
  associationsToModel,
  associationsFromModel,
  cache,
  createFields
}) {

  let createMutationName = mutationName(Model, 'createOne');
  mutations[createMutationName] = mutationWithClientMutationId({
    name: createMutationName,
    description: `Create ${Model.name} record.`,
    inputFields: () => {
      return createFields[Model.name]
    },
    outputFields: () => {
      let output = {};
      // New Record
      output[camelcase(`new_${Model.name}`)] = {
        type: modelType,
        description: `The new ${Model.name}, if successfully created.`,
        resolve: (args,e,context,info) => {
          return resolver(Model, {
          })({}, {
            [Model.primaryKeyAttribute]: args[Model.primaryKeyAttribute]
          }, context, info);
        }
      };

      // New Edges
      _.each(associationsToModel[Model.name], (a) => {
        let {
          from,
          type: atype,
          key: field
        } = a;
        // console.log("Edge To", Model.name, "From", from, field, atype);
        if (atype !== "BelongsTo") {
          // HasMany Association
          let {connection} = associationsFromModel[from][`${Model.name}_${field}`];
          let fromType = ModelTypes[from];
          // let nodeType = conn.nodeType;
          // let association = Model.associations[field];
          // let targetType = association
          // console.log("Connection", Model.name, field, nodeType, conn, association);
          output[camelcase(`new_${fromType.name}_${field}_Edge`)] = {
            type: connection.edgeType,
            resolve: (payload) => connection.resolveEdge(payload)
          };
        }
      });
      _.each(associationsFromModel[Model.name], (a) => {
        let {
          to,
          type: atype,
          foreignKey,
          key: field
        } = a;
        // console.log("Edge From", Model.name, "To", to, field, as, atype, foreignKey);
        if (atype === "BelongsTo") {
          // BelongsTo association
          let toType = ModelTypes[to];
          output[field] = {
            type: toType,
            resolve: (args,e,context,info) => {
              return resolver(Models[toType.name], {
              })({}, { id: args[foreignKey] }, context, info);
            }
          };
        }
      });
      return output;
    },
    mutateAndGetPayload: (data) => {

      let associationsToInclude = {
        include: []
      }
      convertFieldsFromGlobalId(Model, data);
      var associationNames = {};
      condenseAssociations(associationNames, undefined, Model.associations, data);

      function buildUpIncludes (associationsToInclude, associations, associationNames) {
        _.each(associations,function (association, akey) {
          let relatedAssociationsToInclude = {
            association: association,
            include: []
          }
          if (associationNames[akey]) {
            associationsToInclude.include.push(relatedAssociationsToInclude)
            buildUpIncludes(relatedAssociationsToInclude, association.target.associations, associationNames[akey])
          }
        })
      }
      buildUpIncludes(associationsToInclude, Model.associations, associationNames)
      var a = Model.create(data,associationsToInclude)
      return a
    }
  });

}

function _findRecord({
  queries,
  Model,
  modelType
}) {
  let findByIdQueryName = queryName(Model, 'findById'); //`find${Model.name}ById`;
  queries[findByIdQueryName] = {
    type: modelType,
    args: defaultArgs(Model),
    resolve: resolver(Model, {
    })
  };
}

function _findAll({
  queries,
  Model,
  modelType
}) {
  let findAllQueryName = queryName(Model, 'findAll');
  queries[findAllQueryName] = {
    type: new GraphQLList(modelType),
    args: defaultListArgs(Model),
    resolve: resolver(Model)
  };
}

function _countAll({ queries, Model, modelType }) {
  let countAllQueryName = camelcase(Model.name + "Count");
  const { where, include } = defaultListArgs(Model);
  queries[countAllQueryName] = {
    type: GraphQLInt,
    args: {
      where,
      include
    },
    resolve: function(source, args, context, info) {
      var findOptions = {};
      findOptions = argsToFindOptions.default(args, []);
      if (findOptions.include) {
        _.each(findOptions.include, function(includeObj) {
          var association =
            Model.associations[
              includeObj.model.toLowerCase
                ? includeObj.model.toLowerCase()
                : includeObj.model.name
            ];
          includeObj.model = association.target;
          includeObj.as = association.as;
        });
        findOptions.include = _.toArray(findOptions.include);
      }
      return Model.count(findOptions);
    }
  };
}


function _createRecords({
  mutations,
  Model,
  modelType,
  ModelTypes,
  associationsToModel,
  associationsFromModel,
  cache,
  postgresOnly
}) {
  let createMutationName = mutationName(Model, "create");
  mutations[createMutationName] = mutationWithClientMutationId({
    name: createMutationName,
    description: `Create multiple ${Model.name} records.`,
    inputFields: () => {
      // return modelType
      let fields = attributeFields(Model, {
        exclude: Model.excludeFields ? Model.excludeFields : [],
        commentToDescription: true,
        // exclude: [Model.primaryKeyAttribute],
        cache
      });
      convertFieldsToGlobalId(Model, fields);

      // FIXME: Handle timestamps
      // console.log('_timestampAttributes', Model._timestampAttributes);
      delete fields.createdAt;
      delete fields.updatedAt;

      let createModelTypeName = `Create${Model.name}ValuesInput`;
      let CreateModelValuesType =
        cache[createModelTypeName] ||
        new GraphQLInputObjectType({
          name: createModelTypeName,
          description: "Values to create",
          fields
        });
      cache[createModelTypeName] = CreateModelValuesType;

      // return fields;

      return {
        values: {
          type: new GraphQLList(CreateModelValuesType)
        }
      };
    },
    outputFields: () => {
      let output = {};
      // New Record
      output[camelcase(`new_${Model.name}`)] = {
        type: modelType,
        description: `The new ${Model.name}, if successfully created.`,
        resolve: (args, e, context, info) => {
          return resolver(Model, {})(
            {},
            {
              [Model.primaryKeyAttribute]: args[Model.primaryKeyAttribute]
            },
            context,
            info
          );
        }
      };

      // New Edges
      _.each(associationsToModel[Model.name], a => {
        let { from, type: atype, key: field } = a;
        // console.log("Edge To", Model.name, "From", from, field, atype);
        if (atype !== "BelongsTo") {
          // HasMany Association
          let { connection } = associationsFromModel[from][
            `${Model.name}_${field}`
          ];
          let fromType = ModelTypes[from];
          // let nodeType = conn.nodeType;
          // let association = Model.associations[field];
          // let targetType = association
          // console.log("Connection", Model.name, field, nodeType, conn, association);
          output[camelcase(`new_${fromType.name}_${field}_Edge`)] = {
            type: connection.edgeType,
            resolve: payload => connection.resolveEdge(payload)
          };
        }
      });
      _.each(associationsFromModel[Model.name], a => {
        let { to, type: atype, foreignKey, key: field } = a;
        // console.log("Edge From", Model.name, "To", to, field, as, atype, foreignKey);
        if (atype === "BelongsTo") {
          // BelongsTo association
          let toType = ModelTypes[to];
          output[field] = {
            type: toType,
            resolve: (args, e, context, info) => {
              return resolver(Models[toType.name], {})(
                {},
                { id: args[foreignKey] },
                context,
                info
              );
            }
          };
        }
      });
      let updateModelOutputTypeName = `Update${Model.name}Output`;
      let outputType =
        cache[updateModelOutputTypeName] ||
        new GraphQLObjectType({
          name: updateModelOutputTypeName,
          fields: output
        });
      cache[updateModelOutputTypeName] = outputType;
      return {
        nodes: {
          type: new GraphQLList(outputType)
        },
        affectedCount: {
          type: GraphQLInt
        }
      };
    },
    mutateAndGetPayload: ({ values }) => {
      values.forEach(function(value) {
        convertFieldsFromGlobalId(Model, value);
      });
      return Model.bulkCreate(values, 
        postgresOnly ? { returning: true } : { individualHooks: true })
      .then(result => { //tnr: returning: true only works for postgres! https://github.com/sequelize/sequelize/issues/5466
        return {
          nodes: result,
          affectedCount: result.length
          // where,
          // affectedCount: result[0]
        };
      });
    }
  });
}

function _updateRecords({
  mutations,
  Model,
  modelType,
  ModelTypes,
  associationsToModel,
  associationsFromModel,
  cache
}) {

  let updateMutationName = mutationName(Model, 'update');
  mutations[updateMutationName] = mutationWithClientMutationId({
    name: updateMutationName,
    description: `Update multiple ${Model.name} records.`,
    inputFields/*args*/: () => {
      let fields = attributeFields(Model, {
        exclude: Model.excludeFields ? Model.excludeFields : [],
        commentToDescription: true,
        allowNull: true,
        cache
      });

      convertFieldsToGlobalId(Model, fields);

      let updateModelTypeName = `Update${Model.name}ValuesInput`;
      let UpdateModelValuesType = cache[updateModelTypeName] || new GraphQLInputObjectType({
        name: updateModelTypeName,
        description: "Values to update",
        fields
      });
      cache[updateModelTypeName] = UpdateModelValuesType;

      var UpdateModelWhereType = new GraphQLInputObjectType({
        name: `Update${Model.name}WhereInput`,
        description: "Options to describe the scope of the search.",
        fields
      });

      return {
        values: {
          type: UpdateModelValuesType
        },
        where: {
          type: UpdateModelWhereType,
        }
      };

    },
    outputFields/*type*/: () => {
      let output = {};
      // New Record
      output[camelcase(`updated_${Model.name}`)] = {
        type: modelType,
        description: `${Model.name}, if successfully updated.`,
        resolve: (args,e,context,info) => {
          return resolver(Model, {
          })({}, {
            [Model.primaryKeyAttribute]: args[Model.primaryKeyAttribute]
          }, context, info);
        }
      };

      // New Edges
      _.each(associationsToModel[Model.name], (a) => {
        let {
          from,
          type: atype,
          key: field
        } = a;
        // console.log("Edge To", Model.name, "From", from, field, atype);
        if (atype !== "BelongsTo") {
          // HasMany Association
          let {connection} = associationsFromModel[from][`${Model.name}_${field}`];
          let fromType = ModelTypes[from];
          // console.log("Connection", Model.name, field, nodeType, conn, association);
          output[camelcase(`new_${fromType.name}_${field}_Edge`)] = {
            type: connection.edgeType,
            resolve: (payload) => connection.resolveEdge(payload)
          };
        }
      });
      _.each(associationsFromModel[Model.name], (a) => {
        let {
          to,
          type: atype,
          foreignKey,
          key: field
        } = a;
        // console.log("Edge From", Model.name, "To", to, field, as, atype, foreignKey);
        if (atype === "BelongsTo") {
          // BelongsTo association
          let toType = ModelTypes[to];
          output[field] = {
            type: toType,
            resolve: (args,e,context,info) => {
              return resolver(Models[toType.name], {
              })({}, { id: args[foreignKey] }, context, info);
            }
          };
        }
      });
      // console.log(`${Model.name} mutation output`, output);
      let updateModelOutputTypeName = `Update${Model.name}Output`;
      let outputType = cache[updateModelOutputTypeName] || new GraphQLObjectType({
        name: updateModelOutputTypeName,
        fields: output
      });
      cache[updateModelOutputTypeName] = outputType;

      return {
        'nodes': {
          type: new GraphQLList(outputType),
          resolve: (source, args, context, info) => {
            // console.log('update', source, args);
            return Model.findAll({
              where: source.where
            });
          }
        },
        'affectedCount': {
          type: GraphQLInt
        }
      };
    },
    mutateAndGetPayload/*resolve*/: (data) => {
      // console.log('mutate', data);
      let {values, where} = data;
      convertFieldsFromGlobalId(Model, values);
      convertFieldsFromGlobalId(Model, where);
      return Model.update(values, {
        where
      })
      .then((result) => {
        return {
          where,
          affectedCount: result[0]
        };
      });

    }
  });

}

function _batchUpdateRecords({
  mutations,
  Model,
  modelType,
  ModelTypes,
  associationsToModel,
  associationsFromModel,
  cache
}) {

  let updateMutationName = camelcase("batch_Update_" + Model.name)
  mutations[updateMutationName] = mutationWithClientMutationId({
    name: updateMutationName,
    description: `Batch update multiple ${Model.name} records.`,
    inputFields: () => {
      let fields = attributeFields(Model, {
        exclude: Model.excludeFields ? Model.excludeFields : [],
        commentToDescription: true,
        allowNull: true,
        cache
      });

      convertFieldsToGlobalId(Model, fields);

      let updateModelTypeName = `BatchUpdate${Model.name}ValuesInput`;
      let UpdateModelValuesType = cache[updateModelTypeName] || new GraphQLInputObjectType({
        name: updateModelTypeName,
        description: "Values to update",
        fields
      });
      cache[updateModelTypeName] = UpdateModelValuesType;

      var UpdateModelWhereType = new GraphQLInputObjectType({
        name: `BatchUpdate${Model.name}WhereInput`,
        description: "Options to describe the scope of the search.",
        fields
      });

      return {
        updateItems: {
          type: new GraphQLList(
              new GraphQLInputObjectType(
                {
                    name: Model.name + "BatchUpdateInput",
                    fields: () => (
                      {
                        values: {type: UpdateModelValuesType},
                        where: {type: UpdateModelWhereType}
                      }
                    )
                }
              )
            )
        }
      };

    },
    outputFields: () => {
      let output = {};
      // New Record
      output[camelcase(`updated_${Model.name}`)] = {
        type: modelType,
        description: `The new ${Model.name}, if successfully created.`,
        resolve: (args,e,context,info) => {
          return resolver(Model, {
          })({}, {
            [Model.primaryKeyAttribute]: args[Model.primaryKeyAttribute]
          }, context, info);
        }
      };

      // New Edges
      _.each(associationsToModel[Model.name], (a) => {
        let {
          from,
          type: atype,
          key: field
        } = a;
        // console.log("Edge To", Model.name, "From", from, field, atype);
        if (atype !== "BelongsTo") {
          // HasMany Association
          let {connection} = associationsFromModel[from][`${Model.name}_${field}`];
          let fromType = ModelTypes[from];
          // console.log("Connection", Model.name, field, nodeType, conn, association);
          output[camelcase(`new_${fromType.name}_${field}_Edge`)] = {
            type: connection.edgeType,
            resolve: (payload) => connection.resolveEdge(payload)
          };
        }
      });
      _.each(associationsFromModel[Model.name], (a) => {
        let {
          to,
          type: atype,
          foreignKey,
          key: field
        } = a;
        // console.log("Edge From", Model.name, "To", to, field, as, atype, foreignKey);
        if (atype === "BelongsTo") {
          // BelongsTo association
          let toType = ModelTypes[to];
          output[field] = {
            type: toType,
            resolve: (args,e,context,info) => {
              return resolver(Models[toType.name], {
              })({}, { id: args[foreignKey] }, context, info);
            }
          };
        }
      });
      // console.log(`${Model.name} mutation output`, output);
      let updateModelOutputTypeName = `BatchUpdate${Model.name}Output`;
      let outputType = cache[updateModelOutputTypeName] || new GraphQLObjectType({
        name: updateModelOutputTypeName,
        fields: output
      });
      cache[updateModelOutputTypeName] = outputType;

      return {
        'nodes': {
          type: new GraphQLList(outputType),
          resolve: (source, args, context, info) => {
            // console.log('update', source, args);
            let specialWhere = {
              "$or": []
            }
            source.updateItems.forEach(function (item) {
              specialWhere["$or"].push(item.where)
            })

            return Model.findAll({
              where: specialWhere
            });
          }
        },
        'affectedCount': {
          type: GraphQLInt
        }
      };
    },
    mutateAndGetPayload: (data) => {
      // console.log('mutate', data);
      const {updateItems} = data
      
      // return Model.update(values, {
      //   where
      // })
      // .then((result) => {
      //   return {
      //     where,
      //     affectedCount: result[0]
      //   };
      // });
      const dialectMap = {
        postgres: {
          begin: "BEGIN; ",
          end: " COMMIT",
        },
        oracle: {
          begin: "BEGIN; ",
          end: " COMMIT; END",
        },
        sqlite: {
          begin: " ",
          end: " ",
        },

      }

      const sequelize = Model.sequelize
      let dialect = sequelize.getDialect();
      const chosenDialect = dialectMap[dialect]
      if(!chosenDialect) throw new Error("batch update mutation not implemented for dialect: " + dialect);
      let qry = sequelize.dialect.QueryGenerator;
      let str = chosenDialect.begin;
      updateItems.forEach(({values, where}) => {
        // convertFieldsFromGlobalId(Model, values);
        // convertFieldsFromGlobalId(Model, where);
        
        str += qry.updateQuery(Model.tableName, values, where) + " ; ";
      });
      str += chosenDialect.end;
      return sequelize.query(str)
             .then(() => {
              return {
                updateItems
              };
             });
    }
  });

}

function _updateRecord({
  mutations,
  Model,
  modelType,
  ModelTypes,
  associationsToModel,
  associationsFromModel,
  cache
}) {

  let updateMutationName = mutationName(Model, 'updateOne');
  mutations[updateMutationName] = mutationWithClientMutationId({
    name: updateMutationName,
    description: `Update a single ${Model.name} record.`,
    inputFields: () => {
      let fields = attributeFields(Model, {
        exclude: Model.excludeFields ? Model.excludeFields : [],
        commentToDescription: true,
        allowNull: true,
        cache
      });

      convertFieldsToGlobalId(Model, fields);

      let updateModelInputTypeName = `Update${Model.name}ValuesInput`;
      let UpdateModelValuesType = cache[updateModelInputTypeName] || new GraphQLInputObjectType({
        name: updateModelInputTypeName,
        description: "Values to update",
        fields
      });
      cache[updateModelInputTypeName] = UpdateModelValuesType;

      return {
        [Model.primaryKeyAttribute]: globalIdField(Model.name),
        values: {
          type: UpdateModelValuesType
        }
      };

    },
    outputFields: () => {
      let output = {};
      // New Record
      output[camelcase(`updated_${Model.name}`)] = {
        type: modelType,
        description: `The new ${Model.name}, if successfully created.`,
        resolve: (args,e,context,info) => {
          return resolver(Model, {
          })({}, {
            [Model.primaryKeyAttribute]: args[Model.primaryKeyAttribute]
          }, context, info);
        }
      };

      // New Edges
      _.each(associationsToModel[Model.name], (a) => {
        let {
          from,
          type: atype,
          key: field
        } = a;
        // console.log("Edge To", Model.name, "From", from, field, atype);
        if (atype !== "BelongsTo") {
          // HasMany Association
          let {connection} = associationsFromModel[from][`${Model.name}_${field}`];
          let fromType = ModelTypes[from];
          // console.log("Connection", Model.name, field, nodeType, conn, association);
          output[camelcase(`new_${fromType.name}_${field}_Edge`)] = {
            type: connection.edgeType,
            resolve: (payload) => connection.resolveEdge(payload)
          };
        }
      });
      _.each(associationsFromModel[Model.name], (a) => {
        let {
          to,
          type: atype,
          foreignKey,
          key: field
        } = a;
        // console.log("Edge From", Model.name, "To", to, field, as, atype, foreignKey);
        if (atype === "BelongsTo") {
          // BelongsTo association
          let toType = ModelTypes[to];
          output[field] = {
            type: toType,
            resolve: (args,e,context,info) => {
              return resolver(Models[toType.name], {
              })({}, { id: args[foreignKey] }, context, info);
            }
          };
        }
      });
      // console.log(`${Model.name} mutation output`, output);

      let updateModelOutputTypeName = `Update${Model.name}Output`;
      let outputType = cache[updateModelOutputTypeName] || new GraphQLObjectType({
        name: updateModelOutputTypeName,
        fields: output
      });
      cache[updateModelOutputTypeName] = outputType;

      return output;

    },
    mutateAndGetPayload: (data) => {
      // console.log('mutate', data);
      let {values} = data;
      let where = {
        [Model.primaryKeyAttribute]: data[Model.primaryKeyAttribute]
      };
      convertFieldsFromGlobalId(Model, values);
      convertFieldsFromGlobalId(Model, where);

      return Model.update(values, {
        where
      })
      .then((result) => {
        return where;
      });

    }
  });

}


function _deleteRecords({
  mutations,
  Model,
  modelType,
  ModelTypes,
  associationsToModel,
  associationsFromModel,
  cache
}) {

  let deleteMutationName = mutationName(Model, 'delete');
  mutations[deleteMutationName] = mutationWithClientMutationId({
    name: deleteMutationName,
    description: `Delete ${Model.name} records.`,
    inputFields: () => {
      const { where } = defaultListArgs(Model);
      return {
        where
      };
    },
    outputFields: () => {
      return {
        'affectedCount': {
          type: GraphQLInt
        }
      };
    },
    mutateAndGetPayload: (data) => {
      let {where} = data;
      return Model.destroy({
        where
      })
      .then((affectedCount) => {
        return {
          where,
          affectedCount
        };
      });
    }
  });

}


function _deleteRecord({
  mutations,
  Model,
  modelType,
  ModelTypes,
  associationsToModel,
  associationsFromModel,
  cache
}) {

  let deleteMutationName = mutationName(Model, 'deleteOne');
  mutations[deleteMutationName] = mutationWithClientMutationId({
    name: deleteMutationName,
    description: `Delete single ${Model.name} record.`,
    inputFields: () => {
      return {
        [Model.primaryKeyAttribute]: globalIdField(Model.name),
      };
    },
    outputFields: () => {
      let idField = camelcase(`deleted_${Model.name}_id`);
      return {
        [idField]: {
          type: GraphQLID,
          resolve(source) {
            return source[Model.primaryKeyAttribute];
          }
        }
      };
    },
    mutateAndGetPayload: (data) => {
      let where = {
        [Model.primaryKeyAttribute]: data[Model.primaryKeyAttribute]
      };
      convertFieldsFromGlobalId(Model, where);
      return Model.destroy({
        where
      })
      .then((affectedCount) => {
        return data;
      });
    }
  });

}

function getSchema(sequelize, options) {
  options = options || {}
  const postgresOnly = options.postgresOnly
  const {nodeInterface, nodeField, nodeTypeMapper} = sequelizeNodeInterface(sequelize);

  const Models = sequelize.models;
  const queries = {};
  const mutations = {};
  const associationsToModel = {};
  const associationsFromModel = {};
  const cache = {};

  // Create Connections
  let createFields = {}
  
  _.each(Models, (Model) => {
    createFields[Model.name] = attributeFields(Model, {
      exclude: Model.excludeFields ? Model.excludeFields : [],
      commentToDescription: true,
      allowNull: true,
      cache
    })
    convertFieldsToGlobalId(Model, createFields[Model.name]);

    delete createFields[Model.name].createdAt
    delete createFields[Model.name].updatedAt
  })
  _.each(Models, (Model) => {
    _.each(Model.associations, (association, akey) => {
      const associatedModelName = association.target.name
      cache[associatedModelName + '_related'] = cache[associatedModelName + '_related'] || new GraphQLInputObjectType({
              name: associatedModelName + '_related',
              fields: createFields[associatedModelName]
            })

      createFields[Model.name][akey] = {
        type: association.associationType === 'BelongsTo' 
          ? cache[associatedModelName + '_related']  
          : new GraphQLList(cache[associatedModelName + '_related'])
      }


      
    })
  })

  // Create types map
  const ModelTypes = Object.keys(Models).reduce(function (types, key) {
    const Model = Models[key];
    const modelType = new GraphQLObjectType({
      name: Model.name,
      fields: () => {
        // Lazily load fields
        return Object.keys(Model.associations).reduce((fields,akey) => {
          let association = Model.associations[akey];
          let atype = association.associationType;
          let target = association.target;
          let targetType = ModelTypes[target.name];
          if (atype === "BelongsTo") {
            fields[akey] = {
              type: targetType,
              resolve: resolver(association, {
                separate: true
              })
            };
          } else {
            const connectionName = connectionNameForAssociation(Model, akey);
            const connection = ModelTypes[connectionName];
            fields[akey] = {
              type: connection.connectionType,
              args: connection.connectionArgs,
              resolve: connection.resolve
            };
          }
          return fields;
        },
          // Attribute fields
          attributeFields(Model, {
            exclude: Model.excludeFields ? Model.excludeFields : [],
            globalId: true,
            commentToDescription: true,
            cache
          })
        );
      },
      interfaces: [nodeInterface]
    });
    types[Model.name] = modelType;
    // === CRUD ====
    // CREATE single
    _createRecord({
      mutations,
      Model,
      modelType,
      ModelTypes: types,
      associationsToModel,
      associationsFromModel,
      cache,
      createFields
    });

    // CREATE multiple
    _createRecords({
      mutations,
      Model,
      modelType,
      ModelTypes: types,
      associationsToModel,
      associationsFromModel,
      cache,
      postgresOnly
    });

    // READ single
    _findRecord({
      queries,
      Model,
      modelType
    });

    // READ all
    _findAll({
      queries,
      Model,
      modelType
    });

    // READ all
    _countAll({
      queries,
      Model,
      modelType
    });

    // UPDATE single
    _updateRecord({
      mutations,
      Model,
      modelType,
      ModelTypes: types,
      associationsToModel,
      associationsFromModel,
      cache
    });

    // UPDATE multiple
    _updateRecords({
      mutations,
      Model,
      modelType,
      ModelTypes: types,
      associationsToModel,
      associationsFromModel,
      cache
    });

    // UPDATE multiple
    _batchUpdateRecords({
      mutations,
      Model,
      modelType,
      ModelTypes: types,
      associationsToModel,
      associationsFromModel,
      cache
    });

    // DELETE single
    _deleteRecord({
      mutations,
      Model,
      modelType,
      ModelTypes: types,
      associationsToModel,
      associationsFromModel,
      cache
    });

    _deleteRecords({
      mutations,
      Model,
      modelType,
      ModelTypes: types,
      associationsToModel,
      associationsFromModel,
      cache
    });
    

    return types;
  }, {});

  

  _.each(Models, (Model) => {
    _.each(Model.associations, (association, akey) => {
      //make more connections
      let atype = association.associationType;
      let target = association.target;
      let foreignKey = association.foreignKey;
      let as = association.as;
      let targetType = ModelTypes[target.name];
      const connectionName = connectionNameForAssociation(Model, akey);
      if (atype === "BelongsTo") {
        // BelongsTo
        _.set(associationsToModel, `${targetType.name}.${akey}`, {
          from: Model.name,
          type: atype,
          key: akey,
          foreignKey,
          as
        });
        _.set(associationsFromModel, `${Model.name}.${akey}`, {
          to: targetType.name,
          type: atype,
          key: akey,
          foreignKey,
          as
        });
      } else {
        // HasMany
        let edgeFields = {};
        if (atype === "BelongsToMany") {
          let aModel = association.through.model;
          // console.log('BelongsToMany model', aModel);
          edgeFields = attributeFields(aModel, {
            exclude: aModel.excludeFields ? aModel.excludeFields : [],
            globalId: true,
            commentToDescription: true,
            cache
          });
          // Pass Through model to resolve function
          _.each(edgeFields, (edgeField, field) => {
            let oldResolve = edgeField.resolve;
            // console.log(field, edgeField, Object.keys(edgeField));
            if (typeof oldResolve !== 'function') {
              // console.log(oldResolve);
              let resolve = (source, args, context, info) => {
                let e = source.node[aModel.name];
                return e[field];
              };
              edgeField.resolve = resolve.bind(edgeField);
            } else {
              let resolve = (source, args, context, info) => {
                let e = source.node[aModel.name];
                return oldResolve(e, args, context, info);
              };
              edgeField.resolve = resolve.bind(edgeField);
            }
          });
        }

        const connection = sequelizeConnection({
          name: connectionName,
          nodeType: targetType,
          target: association,
          connectionFields: {
            total: {
              type: new GraphQLNonNull(GraphQLInt),
              description: `Total count of ${targetType.name} results associated with ${Model.name}.`,
              resolve({source}) {
                let {accessors} = association;
                return source[accessors.count]();
              }
            }
          },
          edgeFields
        });
        ModelTypes[connectionName] = connection;
        _.set(associationsToModel, `${targetType.name}.${Model.name}_${akey}`, {
          from: Model.name,
          type: atype,
          key: akey,
          connection,
          as
        });
        _.set(associationsFromModel, `${Model.name}.${targetType.name}_${akey}`, {
          to: targetType.name,
          type: atype,
          key: akey,
          connection,
          as
        });
      }

    });
  });
  // console.log("associationsToModel", associationsToModel);
  // console.log("associationsFromModel", associationsFromModel);

  // Custom Queries and Mutations
  _.each(Object.keys(Models), (key) => {
    const Model = Models[key];

    // Custom Queries
    if (Model.queries) {
      _.assign(queries, Model.queries(Models, ModelTypes, resolver));
    }
    // Custom Mutations
    if (Model.mutations) {
      _.assign(mutations, Model.mutations(Models, ModelTypes, resolver));
    }

  });

  // Configure NodeTypeMapper
  nodeTypeMapper.mapTypes({
    ...ModelTypes
  });

  const Queries = new GraphQLObjectType({
    name: "Root",
    description: "Root of the Schema",
    fields: () => ({
      root: {
        // Cite: https://github.com/facebook/relay/issues/112#issuecomment-170648934
        type: new GraphQLNonNull(Queries),
        description: "Self-Pointer from Root to Root",
        resolve: () => ({})
      },
      ...queries,
      node: nodeField
    })
  });

  const Mutations = new GraphQLObjectType({
    name: "Mutations",
    fields: {
      ...mutations
    }
  });

  return new GraphQLSchema({
    query: Queries,
    mutation: Mutations
  });

};

module.exports = {
  getSchema
};
