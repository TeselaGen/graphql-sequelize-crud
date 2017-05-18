"use strict";

var _extends = Object.assign || function (target) { for (var i = 1; i < arguments.length; i++) { var source = arguments[i]; for (var key in source) { if (Object.prototype.hasOwnProperty.call(source, key)) { target[key] = source[key]; } } } return target; };

function _defineProperty(obj, key, value) { if (key in obj) { Object.defineProperty(obj, key, { value: value, enumerable: true, configurable: true, writable: true }); } else { obj[key] = value; } return obj; }

var _require = require('graphql'),
    GraphQLObjectType = _require.GraphQLObjectType,
    GraphQLSchema = _require.GraphQLSchema,
    GraphQLInt = _require.GraphQLInt,
    GraphQLString = _require.GraphQLString,
    GraphQLList = _require.GraphQLList,
    GraphQLNonNull = _require.GraphQLNonNull,
    GraphQLBoolean = _require.GraphQLBoolean,
    GraphQLInputObjectType = _require.GraphQLInputObjectType,
    GraphQLID = _require.GraphQLID;

var _ = require('lodash');
var pluralize = require('pluralize');
var camelcase = require('camelcase');

var _require2 = require("graphql-relay"),
    fromGlobalId = _require2.fromGlobalId,
    globalIdField = _require2.globalIdField,
    mutationWithClientMutationId = _require2.mutationWithClientMutationId;

var _require3 = require("graphql-sequelize"),
    defaultArgs = _require3.defaultArgs,
    defaultListArgs = _require3.defaultListArgs,
    attributeFields = _require3.attributeFields,
    argsToFindOptions = _require3.argsToFindOptions,
    resolver = _require3.resolver,
    _require3$relay = _require3.relay,
    sequelizeNodeInterface = _require3$relay.sequelizeNodeInterface,
    sequelizeConnection = _require3$relay.sequelizeConnection;

var jsonType = require("graphql-sequelize/lib/types/jsonType.js");

function connectionNameForAssociation(Model, associationName) {
  return camelcase(Model.name + '_' + associationName);
}
function queryName(Model, type) {
  switch (type) {
    case 'findAll':
      {
        return camelcase(pluralize.plural(Model.name));
      }
    case 'findById':
      {
        return camelcase(Model.name);
      }
    default:
      {
        console.warn('Unknown query type: ', type);
        return camelcase(type + '_' + Model.name);
      }
  }
}

function mutationName(Model, type) {
  switch (type) {
    case 'create':
      {
        return camelcase(type + '_' + pluralize.plural(Model.name));
      }
    case 'createOne':
      {
        return camelcase('create_' + Model.name);
      }
    case 'update':
      {
        return camelcase(type + '_' + pluralize.plural(Model.name));
      }
    case 'updateOne':
      {
        return camelcase('update_' + Model.name);
      }
    case 'delete':
      {
        return camelcase(type + '_' + pluralize.plural(Model.name));
      }
    case 'deleteOne':
      {
        return camelcase('delete_' + Model.name);
      }
    default:
      {
        console.warn('Unknown mutation type: ', type);
        return camelcase(type + '_' + Model.name);
      }
  }
}

function convertFieldsToGlobalId(Model, fields) {
  // Fix Relay Global ID
  _.each(Object.keys(Model.rawAttributes), function (k) {
    if (k === "clientMutationId") {
      return;
    }
    // Check if reference attribute
    var attr = Model.rawAttributes[k];
    if (!attr) return;
    if (attr.references) {
      // console.log(`Replacing ${Model.name}'s field ${k} with globalIdField.`);
      var modelName = attr.references.model;
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
  _.each(Object.keys(data), function (k) {
    if (k === "clientMutationId") {
      return;
    }
    // Check if reference attribute
    var attr = Model.rawAttributes[k];
    if (!attr) return;
    if (attr.references || attr.primaryKey) {
      var _fromGlobalId = fromGlobalId(data[k]),
          id = _fromGlobalId.id;

      // Check if id is numeric.


      if (!_.isNaN(_.toNumber(id))) {
        data[k] = parseInt(id);
      } else {
        data[k] = id;
      }
    }
  });
}

function _createRecord(_ref) {
  var mutations = _ref.mutations,
      Model = _ref.Model,
      modelType = _ref.modelType,
      ModelTypes = _ref.ModelTypes,
      associationsToModel = _ref.associationsToModel,
      associationsFromModel = _ref.associationsFromModel,
      cache = _ref.cache,
      createFields = _ref.createFields;


  var createMutationName = mutationName(Model, 'createOne');
  mutations[createMutationName] = mutationWithClientMutationId({
    name: createMutationName,
    description: 'Create ' + Model.name + ' record.',
    inputFields: function inputFields() {
      return createFields[Model.name];
    },
    outputFields: function outputFields() {
      var output = {};
      // New Record
      output[camelcase('new_' + Model.name)] = {
        type: modelType,
        description: 'The new ' + Model.name + ', if successfully created.',
        resolve: function resolve(args, e, context, info) {
          return resolver(Model, {})({}, _defineProperty({}, Model.primaryKeyAttribute, args[Model.primaryKeyAttribute]), context, info);
        }
      };

      // New Edges
      _.each(associationsToModel[Model.name], function (a) {
        var from = a.from,
            atype = a.type,
            field = a.key;
        // console.log("Edge To", Model.name, "From", from, field, atype);

        if (atype !== "BelongsTo") {
          // HasMany Association
          var connection = associationsFromModel[from][Model.name + '_' + field].connection;

          var fromType = ModelTypes[from];
          // let nodeType = conn.nodeType;
          // let association = Model.associations[field];
          // let targetType = association
          // console.log("Connection", Model.name, field, nodeType, conn, association);
          output[camelcase('new_' + fromType.name + '_' + field + '_Edge')] = {
            type: connection.edgeType,
            resolve: function resolve(payload) {
              return connection.resolveEdge(payload);
            }
          };
        }
      });
      _.each(associationsFromModel[Model.name], function (a) {
        var to = a.to,
            atype = a.type,
            foreignKey = a.foreignKey,
            field = a.key;
        // console.log("Edge From", Model.name, "To", to, field, as, atype, foreignKey);

        if (atype === "BelongsTo") {
          // BelongsTo association
          var toType = ModelTypes[to];
          output[field] = {
            type: toType,
            resolve: function resolve(args, e, context, info) {
              return resolver(Models[toType.name], {})({}, { id: args[foreignKey] }, context, info);
            }
          };
        }
      });
      return output;
    },
    mutateAndGetPayload: function mutateAndGetPayload(data) {

      var associationsToInclude = {
        include: []
      };
      convertFieldsFromGlobalId(Model, data);

      function buildUpIncludes(associationsToInclude, associations, data) {
        _.each(associations, function (association, akey) {
          if (data[akey]) {
            convertFieldsFromGlobalId(association.target, data[akey]);

            var relatedAssociationsToInclude = {
              association: association,
              include: []
            };
            associationsToInclude.include.push(relatedAssociationsToInclude);
            buildUpIncludes(relatedAssociationsToInclude, association.target.associations, data[akey]);
          }
        });
      }
      buildUpIncludes(associationsToInclude, Model.associations, data);
      var a = Model.create(data, associationsToInclude);
      return a;
    }
  });
}

function _findRecord(_ref2) {
  var queries = _ref2.queries,
      Model = _ref2.Model,
      modelType = _ref2.modelType;

  var findByIdQueryName = queryName(Model, 'findById'); //`find${Model.name}ById`;
  queries[findByIdQueryName] = {
    type: modelType,
    args: defaultArgs(Model),
    resolve: resolver(Model, {})
  };
}

function _findAll(_ref3) {
  var queries = _ref3.queries,
      Model = _ref3.Model,
      modelType = _ref3.modelType;

  var findAllQueryName = queryName(Model, 'findAll');
  queries[findAllQueryName] = {
    type: new GraphQLList(modelType),
    args: defaultListArgs(Model),
    resolve: resolver(Model)
  };
}

function _countAll(_ref4) {
  var queries = _ref4.queries,
      Model = _ref4.Model,
      modelType = _ref4.modelType;

  var countAllQueryName = camelcase(Model.name + "Count");

  var _defaultListArgs = defaultListArgs(Model),
      where = _defaultListArgs.where,
      include = _defaultListArgs.include;

  queries[countAllQueryName] = {
    type: GraphQLInt,
    args: {
      where: where,
      include: include
    },
    resolve: function resolve(source, args, context, info) {
      var findOptions = {};
      findOptions = argsToFindOptions.default(args, []);
      if (findOptions.include) {
        _.each(findOptions.include, function (includeObj) {
          var association = Model.associations[includeObj.model.toLowerCase ? includeObj.model.toLowerCase() : includeObj.model.name];
          includeObj.model = association.target;
          includeObj.as = association.as;
        });
        findOptions.include = _.toArray(findOptions.include);
      }
      return Model.count(findOptions);
    }
  };
}

function _createRecords(_ref5) {
  var mutations = _ref5.mutations,
      Model = _ref5.Model,
      modelType = _ref5.modelType,
      ModelTypes = _ref5.ModelTypes,
      associationsToModel = _ref5.associationsToModel,
      associationsFromModel = _ref5.associationsFromModel,
      cache = _ref5.cache,
      postgresOnly = _ref5.postgresOnly;

  var createMutationName = mutationName(Model, "create");
  mutations[createMutationName] = mutationWithClientMutationId({
    name: createMutationName,
    description: 'Create multiple ' + Model.name + ' records.',
    inputFields: function inputFields() {
      // return modelType
      var fields = attributeFields(Model, {
        exclude: Model.excludeFields ? Model.excludeFields : [],
        commentToDescription: true,
        // exclude: [Model.primaryKeyAttribute],
        cache: cache
      });
      convertFieldsToGlobalId(Model, fields);

      // FIXME: Handle timestamps
      // console.log('_timestampAttributes', Model._timestampAttributes);
      delete fields.createdAt;
      delete fields.updatedAt;

      var createModelTypeName = 'Create' + Model.name + 'ValuesInput';
      var CreateModelValuesType = cache[createModelTypeName] || new GraphQLInputObjectType({
        name: createModelTypeName,
        description: "Values to create",
        fields: fields
      });
      cache[createModelTypeName] = CreateModelValuesType;

      // return fields;

      return {
        values: {
          type: new GraphQLList(CreateModelValuesType)
        }
      };
    },
    outputFields: function outputFields() {
      var output = {};
      // New Record
      output[camelcase('new_' + Model.name)] = {
        type: modelType,
        description: 'The new ' + Model.name + ', if successfully created.',
        resolve: function resolve(args, e, context, info) {
          return resolver(Model, {})({}, _defineProperty({}, Model.primaryKeyAttribute, args[Model.primaryKeyAttribute]), context, info);
        }
      };

      // New Edges
      _.each(associationsToModel[Model.name], function (a) {
        var from = a.from,
            atype = a.type,
            field = a.key;
        // console.log("Edge To", Model.name, "From", from, field, atype);

        if (atype !== "BelongsTo") {
          // HasMany Association
          var connection = associationsFromModel[from][Model.name + '_' + field].connection;

          var fromType = ModelTypes[from];
          // let nodeType = conn.nodeType;
          // let association = Model.associations[field];
          // let targetType = association
          // console.log("Connection", Model.name, field, nodeType, conn, association);
          output[camelcase('new_' + fromType.name + '_' + field + '_Edge')] = {
            type: connection.edgeType,
            resolve: function resolve(payload) {
              return connection.resolveEdge(payload);
            }
          };
        }
      });
      _.each(associationsFromModel[Model.name], function (a) {
        var to = a.to,
            atype = a.type,
            foreignKey = a.foreignKey,
            field = a.key;
        // console.log("Edge From", Model.name, "To", to, field, as, atype, foreignKey);

        if (atype === "BelongsTo") {
          // BelongsTo association
          var toType = ModelTypes[to];
          output[field] = {
            type: toType,
            resolve: function resolve(args, e, context, info) {
              return resolver(Models[toType.name], {})({}, { id: args[foreignKey] }, context, info);
            }
          };
        }
      });
      var updateModelOutputTypeName = 'Update' + Model.name + 'Output';
      var outputType = cache[updateModelOutputTypeName] || new GraphQLObjectType({
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
    mutateAndGetPayload: function mutateAndGetPayload(_ref6) {
      var values = _ref6.values;

      values.forEach(function (value) {
        convertFieldsFromGlobalId(Model, value);
      });
      return Model.bulkCreate(values, postgresOnly ? { returning: true } : { individualHooks: true }).then(function (result) {
        //tnr: returning: true only works for postgres! https://github.com/sequelize/sequelize/issues/5466
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

function _updateRecords(_ref7) {
  var mutations = _ref7.mutations,
      Model = _ref7.Model,
      modelType = _ref7.modelType,
      ModelTypes = _ref7.ModelTypes,
      associationsToModel = _ref7.associationsToModel,
      associationsFromModel = _ref7.associationsFromModel,
      cache = _ref7.cache;


  var updateMutationName = mutationName(Model, 'update');
  mutations[updateMutationName] = mutationWithClientMutationId({
    name: updateMutationName,
    description: 'Update multiple ' + Model.name + ' records.',
    inputFields: function inputFields() {
      var fields = attributeFields(Model, {
        exclude: Model.excludeFields ? Model.excludeFields : [],
        commentToDescription: true,
        allowNull: true,
        cache: cache
      });

      convertFieldsToGlobalId(Model, fields);

      var updateModelTypeName = 'Update' + Model.name + 'ValuesInput';
      var UpdateModelValuesType = cache[updateModelTypeName] || new GraphQLInputObjectType({
        name: updateModelTypeName,
        description: "Values to update",
        fields: fields
      });
      cache[updateModelTypeName] = UpdateModelValuesType;

      var UpdateModelWhereType = new GraphQLInputObjectType({
        name: 'Update' + Model.name + 'WhereInput',
        description: "Options to describe the scope of the search.",
        fields: fields
      });

      return {
        values: {
          type: UpdateModelValuesType
        },
        where: {
          type: UpdateModelWhereType
        }
      };
    },
    outputFields: function outputFields() {
      var output = {};
      // New Record
      output[camelcase('new_' + Model.name)] = {
        type: modelType,
        description: 'The new ' + Model.name + ', if successfully created.',
        resolve: function resolve(args, e, context, info) {
          return resolver(Model, {})({}, _defineProperty({}, Model.primaryKeyAttribute, args[Model.primaryKeyAttribute]), context, info);
        }
      };

      // New Edges
      _.each(associationsToModel[Model.name], function (a) {
        var from = a.from,
            atype = a.type,
            field = a.key;
        // console.log("Edge To", Model.name, "From", from, field, atype);

        if (atype !== "BelongsTo") {
          // HasMany Association
          var connection = associationsFromModel[from][Model.name + '_' + field].connection;

          var fromType = ModelTypes[from];
          // console.log("Connection", Model.name, field, nodeType, conn, association);
          output[camelcase('new_' + fromType.name + '_' + field + '_Edge')] = {
            type: connection.edgeType,
            resolve: function resolve(payload) {
              return connection.resolveEdge(payload);
            }
          };
        }
      });
      _.each(associationsFromModel[Model.name], function (a) {
        var to = a.to,
            atype = a.type,
            foreignKey = a.foreignKey,
            field = a.key;
        // console.log("Edge From", Model.name, "To", to, field, as, atype, foreignKey);

        if (atype === "BelongsTo") {
          // BelongsTo association
          var toType = ModelTypes[to];
          output[field] = {
            type: toType,
            resolve: function resolve(args, e, context, info) {
              return resolver(Models[toType.name], {})({}, { id: args[foreignKey] }, context, info);
            }
          };
        }
      });
      // console.log(`${Model.name} mutation output`, output);
      var updateModelOutputTypeName = 'Update' + Model.name + 'Output';
      var outputType = cache[updateModelOutputTypeName] || new GraphQLObjectType({
        name: updateModelOutputTypeName,
        fields: output
      });
      cache[updateModelOutputTypeName] = outputType;

      return {
        'nodes': {
          type: new GraphQLList(outputType),
          resolve: function resolve(source, args, context, info) {
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
    mutateAndGetPayload: function mutateAndGetPayload(data) {
      // console.log('mutate', data);
      var values = data.values,
          where = data.where;

      convertFieldsFromGlobalId(Model, values);
      convertFieldsFromGlobalId(Model, where);
      return Model.update(values, {
        where: where
      }).then(function (result) {
        return {
          where: where,
          affectedCount: result[0]
        };
      });
    }
  });
}

function _updateRecord(_ref8) {
  var mutations = _ref8.mutations,
      Model = _ref8.Model,
      modelType = _ref8.modelType,
      ModelTypes = _ref8.ModelTypes,
      associationsToModel = _ref8.associationsToModel,
      associationsFromModel = _ref8.associationsFromModel,
      cache = _ref8.cache;


  var updateMutationName = mutationName(Model, 'updateOne');
  mutations[updateMutationName] = mutationWithClientMutationId({
    name: updateMutationName,
    description: 'Update a single ' + Model.name + ' record.',
    inputFields: function inputFields() {
      var _ref9;

      var fields = attributeFields(Model, {
        exclude: Model.excludeFields ? Model.excludeFields : [],
        commentToDescription: true,
        allowNull: true,
        cache: cache
      });

      convertFieldsToGlobalId(Model, fields);

      var updateModelInputTypeName = 'Update' + Model.name + 'ValuesInput';
      var UpdateModelValuesType = cache[updateModelInputTypeName] || new GraphQLInputObjectType({
        name: updateModelInputTypeName,
        description: "Values to update",
        fields: fields
      });
      cache[updateModelInputTypeName] = UpdateModelValuesType;

      return _ref9 = {}, _defineProperty(_ref9, Model.primaryKeyAttribute, globalIdField(Model.name)), _defineProperty(_ref9, 'values', {
        type: UpdateModelValuesType
      }), _ref9;
    },
    outputFields: function outputFields() {
      var output = {};
      // New Record
      output[camelcase('new_' + Model.name)] = {
        type: modelType,
        description: 'The new ' + Model.name + ', if successfully created.',
        resolve: function resolve(args, e, context, info) {
          return resolver(Model, {})({}, _defineProperty({}, Model.primaryKeyAttribute, args[Model.primaryKeyAttribute]), context, info);
        }
      };

      // New Edges
      _.each(associationsToModel[Model.name], function (a) {
        var from = a.from,
            atype = a.type,
            field = a.key;
        // console.log("Edge To", Model.name, "From", from, field, atype);

        if (atype !== "BelongsTo") {
          // HasMany Association
          var connection = associationsFromModel[from][Model.name + '_' + field].connection;

          var fromType = ModelTypes[from];
          // console.log("Connection", Model.name, field, nodeType, conn, association);
          output[camelcase('new_' + fromType.name + '_' + field + '_Edge')] = {
            type: connection.edgeType,
            resolve: function resolve(payload) {
              return connection.resolveEdge(payload);
            }
          };
        }
      });
      _.each(associationsFromModel[Model.name], function (a) {
        var to = a.to,
            atype = a.type,
            foreignKey = a.foreignKey,
            field = a.key;
        // console.log("Edge From", Model.name, "To", to, field, as, atype, foreignKey);

        if (atype === "BelongsTo") {
          // BelongsTo association
          var toType = ModelTypes[to];
          output[field] = {
            type: toType,
            resolve: function resolve(args, e, context, info) {
              return resolver(Models[toType.name], {})({}, { id: args[foreignKey] }, context, info);
            }
          };
        }
      });
      // console.log(`${Model.name} mutation output`, output);

      var updateModelOutputTypeName = 'Update' + Model.name + 'Output';
      var outputType = cache[updateModelOutputTypeName] || new GraphQLObjectType({
        name: updateModelOutputTypeName,
        fields: output
      });
      cache[updateModelOutputTypeName] = outputType;

      return output;
    },
    mutateAndGetPayload: function mutateAndGetPayload(data) {
      // console.log('mutate', data);
      var values = data.values;

      var where = _defineProperty({}, Model.primaryKeyAttribute, data[Model.primaryKeyAttribute]);
      convertFieldsFromGlobalId(Model, values);
      convertFieldsFromGlobalId(Model, where);

      return Model.update(values, {
        where: where
      }).then(function (result) {
        return where;
      });
    }
  });
}

function _deleteRecords(_ref10) {
  var mutations = _ref10.mutations,
      Model = _ref10.Model,
      modelType = _ref10.modelType,
      ModelTypes = _ref10.ModelTypes,
      associationsToModel = _ref10.associationsToModel,
      associationsFromModel = _ref10.associationsFromModel,
      cache = _ref10.cache;


  var deleteMutationName = mutationName(Model, 'delete');
  mutations[deleteMutationName] = mutationWithClientMutationId({
    name: deleteMutationName,
    description: 'Delete ' + Model.name + ' records.',
    inputFields: function inputFields() {
      var fields = attributeFields(Model, {
        exclude: Model.excludeFields ? Model.excludeFields : [],
        commentToDescription: true,
        allowNull: true,
        cache: cache
      });
      convertFieldsToGlobalId(Model, fields);
      var DeleteModelWhereType = new GraphQLInputObjectType({
        name: 'Delete' + Model.name + 'WhereInput',
        description: "Options to describe the scope of the search.",
        fields: fields
      });
      return {
        where: {
          type: DeleteModelWhereType
        }
      };
    },
    outputFields: function outputFields() {
      return {
        'affectedCount': {
          type: GraphQLInt
        }
      };
    },
    mutateAndGetPayload: function mutateAndGetPayload(data) {
      var where = data.where;

      convertFieldsFromGlobalId(Model, where);
      return Model.destroy({
        where: where
      }).then(function (affectedCount) {
        return {
          where: where,
          affectedCount: affectedCount
        };
      });
    }
  });
}

function _deleteRecord(_ref11) {
  var mutations = _ref11.mutations,
      Model = _ref11.Model,
      modelType = _ref11.modelType,
      ModelTypes = _ref11.ModelTypes,
      associationsToModel = _ref11.associationsToModel,
      associationsFromModel = _ref11.associationsFromModel,
      cache = _ref11.cache;


  var deleteMutationName = mutationName(Model, 'deleteOne');
  mutations[deleteMutationName] = mutationWithClientMutationId({
    name: deleteMutationName,
    description: 'Delete single ' + Model.name + ' record.',
    inputFields: function inputFields() {
      return _defineProperty({}, Model.primaryKeyAttribute, globalIdField(Model.name));
    },
    outputFields: function outputFields() {
      var idField = camelcase('deleted_' + Model.name + '_id');
      return _defineProperty({}, idField, {
        type: GraphQLID,
        resolve: function resolve(source) {
          return source[Model.primaryKeyAttribute];
        }
      });
    },
    mutateAndGetPayload: function mutateAndGetPayload(data) {
      var where = _defineProperty({}, Model.primaryKeyAttribute, data[Model.primaryKeyAttribute]);
      convertFieldsFromGlobalId(Model, where);
      return Model.destroy({
        where: where
      }).then(function (affectedCount) {
        return data;
      });
    }
  });
}

function getSchema(sequelize, options) {
  options = options || {};
  var postgresOnly = options.postgresOnly;

  var _sequelizeNodeInterfa = sequelizeNodeInterface(sequelize),
      nodeInterface = _sequelizeNodeInterfa.nodeInterface,
      nodeField = _sequelizeNodeInterfa.nodeField,
      nodeTypeMapper = _sequelizeNodeInterfa.nodeTypeMapper;

  var Models = sequelize.models;
  var queries = {};
  var mutations = {};
  var associationsToModel = {};
  var associationsFromModel = {};
  var cache = {};

  // Create Connections
  var createFields = {};

  _.each(Models, function (Model) {
    createFields[Model.name] = attributeFields(Model, {
      exclude: Model.excludeFields ? Model.excludeFields : [],
      commentToDescription: true,
      allowNull: true,
      cache: cache
    });
    convertFieldsToGlobalId(Model, createFields[Model.name]);

    delete createFields[Model.name].createdAt;
    delete createFields[Model.name].updatedAt;
  });
  _.each(Models, function (Model) {
    _.each(Model.associations, function (association, akey) {
      var associatedModelName = association.target.name;

      cache[associatedModelName + '_related'] = cache[associatedModelName + '_related'] || {
        type: new GraphQLList(new GraphQLInputObjectType({
          name: associatedModelName + '_related',
          fields: createFields[associatedModelName]
        })) };

      createFields[Model.name][akey] = cache[associatedModelName + '_related'];
    });
  });

  // Create types map
  var ModelTypes = Object.keys(Models).reduce(function (types, key) {
    var Model = Models[key];
    var modelType = new GraphQLObjectType({
      name: Model.name,
      fields: function fields() {
        // Lazily load fields
        return Object.keys(Model.associations).reduce(function (fields, akey) {
          var association = Model.associations[akey];
          var atype = association.associationType;
          var target = association.target;
          var targetType = ModelTypes[target.name];
          if (atype === "BelongsTo") {
            fields[akey] = {
              type: targetType,
              resolve: resolver(association, {
                separate: true
              })
            };
          } else {
            var connectionName = connectionNameForAssociation(Model, akey);
            var connection = ModelTypes[connectionName];
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
          cache: cache
        }));
      },
      interfaces: [nodeInterface]
    });
    types[Model.name] = modelType;
    // === CRUD ====
    // CREATE single
    _createRecord({
      mutations: mutations,
      Model: Model,
      modelType: modelType,
      ModelTypes: types,
      associationsToModel: associationsToModel,
      associationsFromModel: associationsFromModel,
      cache: cache,
      createFields: createFields
    });

    // CREATE multiple
    _createRecords({
      mutations: mutations,
      Model: Model,
      modelType: modelType,
      ModelTypes: types,
      associationsToModel: associationsToModel,
      associationsFromModel: associationsFromModel,
      cache: cache,
      postgresOnly: postgresOnly
    });

    // READ single
    _findRecord({
      queries: queries,
      Model: Model,
      modelType: modelType
    });

    // READ all
    _findAll({
      queries: queries,
      Model: Model,
      modelType: modelType
    });

    // READ all
    _countAll({
      queries: queries,
      Model: Model,
      modelType: modelType
    });

    // UPDATE single
    _updateRecord({
      mutations: mutations,
      Model: Model,
      modelType: modelType,
      ModelTypes: types,
      associationsToModel: associationsToModel,
      associationsFromModel: associationsFromModel,
      cache: cache
    });

    // UPDATE multiple
    _updateRecords({
      mutations: mutations,
      Model: Model,
      modelType: modelType,
      ModelTypes: types,
      associationsToModel: associationsToModel,
      associationsFromModel: associationsFromModel,
      cache: cache
    });

    // DELETE single
    _deleteRecord({
      mutations: mutations,
      Model: Model,
      modelType: modelType,
      ModelTypes: types,
      associationsToModel: associationsToModel,
      associationsFromModel: associationsFromModel,
      cache: cache
    });

    _deleteRecords({
      mutations: mutations,
      Model: Model,
      modelType: modelType,
      ModelTypes: types,
      associationsToModel: associationsToModel,
      associationsFromModel: associationsFromModel,
      cache: cache
    });

    return types;
  }, {});

  _.each(Models, function (Model) {
    _.each(Model.associations, function (association, akey) {
      //make more connections
      var atype = association.associationType;
      var target = association.target;
      var foreignKey = association.foreignKey;
      var as = association.as;
      var targetType = ModelTypes[target.name];
      var connectionName = connectionNameForAssociation(Model, akey);
      if (atype === "BelongsTo") {
        // BelongsTo
        _.set(associationsToModel, targetType.name + '.' + akey, {
          from: Model.name,
          type: atype,
          key: akey,
          foreignKey: foreignKey,
          as: as
        });
        _.set(associationsFromModel, Model.name + '.' + akey, {
          to: targetType.name,
          type: atype,
          key: akey,
          foreignKey: foreignKey,
          as: as
        });
      } else {
        // HasMany
        var edgeFields = {};
        if (atype === "BelongsToMany") {
          var aModel = association.through.model;
          // console.log('BelongsToMany model', aModel);
          edgeFields = attributeFields(aModel, {
            exclude: aModel.excludeFields ? aModel.excludeFields : [],
            globalId: true,
            commentToDescription: true,
            cache: cache
          });
          // Pass Through model to resolve function
          _.each(edgeFields, function (edgeField, field) {
            var oldResolve = edgeField.resolve;
            // console.log(field, edgeField, Object.keys(edgeField));
            if (typeof oldResolve !== 'function') {
              // console.log(oldResolve);
              var resolve = function resolve(source, args, context, info) {
                var e = source.node[aModel.name];
                return e[field];
              };
              edgeField.resolve = resolve.bind(edgeField);
            } else {
              var _resolve = function _resolve(source, args, context, info) {
                var e = source.node[aModel.name];
                return oldResolve(e, args, context, info);
              };
              edgeField.resolve = _resolve.bind(edgeField);
            }
          });
        }

        var connection = sequelizeConnection({
          name: connectionName,
          nodeType: targetType,
          target: association,
          connectionFields: {
            total: {
              type: new GraphQLNonNull(GraphQLInt),
              description: 'Total count of ' + targetType.name + ' results associated with ' + Model.name + '.',
              resolve: function resolve(_ref14) {
                var source = _ref14.source;
                var accessors = association.accessors;

                return source[accessors.count]();
              }
            }
          },
          edgeFields: edgeFields
        });
        ModelTypes[connectionName] = connection;
        _.set(associationsToModel, targetType.name + '.' + Model.name + '_' + akey, {
          from: Model.name,
          type: atype,
          key: akey,
          connection: connection,
          as: as
        });
        _.set(associationsFromModel, Model.name + '.' + targetType.name + '_' + akey, {
          to: targetType.name,
          type: atype,
          key: akey,
          connection: connection,
          as: as
        });
      }
    });
  });
  // console.log("associationsToModel", associationsToModel);
  // console.log("associationsFromModel", associationsFromModel);

  // Custom Queries and Mutations
  _.each(Object.keys(Models), function (key) {
    var Model = Models[key];

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
  nodeTypeMapper.mapTypes(_extends({}, ModelTypes));

  var Queries = new GraphQLObjectType({
    name: "Root",
    description: "Root of the Schema",
    fields: function fields() {
      return _extends({
        root: {
          // Cite: https://github.com/facebook/relay/issues/112#issuecomment-170648934
          type: new GraphQLNonNull(Queries),
          description: "Self-Pointer from Root to Root",
          resolve: function resolve() {
            return {};
          }
        }
      }, queries, {
        node: nodeField
      });
    }
  });

  var Mutations = new GraphQLObjectType({
    name: "Mutations",
    fields: _extends({}, mutations)
  });

  return new GraphQLSchema({
    query: Queries,
    mutation: Mutations
  });
};

module.exports = {
  getSchema: getSchema
};