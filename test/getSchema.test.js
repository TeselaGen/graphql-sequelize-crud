'use strict';

var expect = require('chai').expect;
const {
  graphql,
  GraphQLSchema
} = require('graphql');
const {
  getSchema
} = require('../src');
const Sequelize = require('sequelize');

describe('getSchema', function() {

  var rand, rand2, rand3, sequelize, User, Todo, TodoAssignee;

  beforeAll(function(cb) {

    sequelize = new Sequelize('database', 'username', 'password', {
      // sqlite! now!
      dialect: 'sqlite',

      // the storage engine for sqlite
      // - default ':memory:'
      // storage: 'path/to/database.sqlite'

      // disable logging; default: console.log
      logging: false

    });

    User = sequelize.define('User', {
      email: {
        type: Sequelize.STRING,
        allowNull: false,
        unique: true
      },
      password: {
        type: Sequelize.STRING,
        allowNull: false
      }
    }, {
      timestamps: false
    });
    Todo = sequelize.define('Todo', {
      id: {
        type: Sequelize.INTEGER,
        autoIncrement: true,
        primaryKey: true,
        allowNull: true
      },
      text: {
        type: Sequelize.STRING,
        allowNull: false
      },
      completed: {
        type: Sequelize.BOOLEAN,
        allowNull: false
      }
    }, {
      timestamps: true
    });
    User.hasMany(Todo, {
      as: 'todos',
      foreignKey: 'userId'
    });
    Todo.belongsTo(User, {
      as: 'user',
      foreignKey: 'userId'
    });

    TodoAssignee = sequelize.define('TodoAssignee', {
      primary: {
        type: Sequelize.BOOLEAN
      }
    }, {
      timestamps: true
    });

    // belongsToMany
    User.belongsToMany(Todo, {
      as: 'assignedTodos',
      through: TodoAssignee
    });
    Todo.belongsToMany(User, {
      as: 'assignees',
      through: TodoAssignee
    });

    cb();

  });

  beforeEach(function(cb) {

    rand = parseInt(Math.random()*1000000000);
    rand2 = rand+1;
    rand3 = rand2+1;

    sequelize.sync({
      force: true
    })
    .then(() => {
      cb();
    });

  })


  it('should return GraphQL Schema', function() {

    var schema = getSchema(sequelize);
    // console.log(Object.keys(schema));
    // console.log(Object.keys(schema._queryType._fields));
    // console.log(Object.keys(schema._mutationType._fields));

    expect(schema).to.be.an.instanceof(GraphQLSchema);
    expect(schema).to.be.an('object');
    expect(schema._queryType).to.be.an('object');
    expect(schema._queryType._fields).to.be.an('object');
    expect(Object.keys(schema._queryType._fields)).to.deep.equal([
      'root',
      'user', 'users', 'userCount',
      'todo', 'todos', 'todoCount',
      'todoAssignee', 'todoAssignees', "todoAssigneeCount",
      'node'
    ]);
    expect(schema._mutationType).to.be.an('object');
    expect(schema._mutationType._fields).to.be.an('object');
    expect(Object.keys(schema._mutationType._fields)).to.deep.equal([
      'createUser',
      'createUsers',
      'updateUser',
      'updateUsers',
      "batchUpdateUser",
      'deleteUser',
      'deleteUsers',
      'createTodo',
      'createTodos',
      'updateTodo',
      'updateTodos',
      'batchUpdateTodo',
      'deleteTodo',
      'deleteTodos',
      'createTodoAssignee',
      'createTodoAssignees',
      'updateTodoAssignee',
      'updateTodoAssignees',
      'batchUpdateTodoAssignee',
      'deleteTodoAssignee',
      'deleteTodoAssignees',
    ]);

  });

  it('should successfully bulk create records', function(cb) {
    var schema = getSchema(sequelize);
    let createUsersMutation = `
      mutation createUsersTest($input: createUsersInput!) {
        createUsers(input: $input) {
          nodes {
            newUser {
              id
              email
              password
            }
          }
          affectedCount
        }
      }
    `;
    let createUsersVariables = {
      "input": {
        "values": [{
          "email": `testuser${rand2}@web.com`,
          "password": `password${rand2}`
        },
        {
          "email": `testuser${rand3}@web.com`,
          "password": `password${rand3}`
        }
        ]
      }
    };
    return graphql(schema, createUsersMutation, {}, {}, createUsersVariables)
      .then(function (result) {
        expect(result).to.be.an('object');
        // console.log('result.errors:', result.errors)
        expect(result.errors).to.be.equal(undefined, `An error occurred: ${result.errors}`);
        expect(result.data).to.be.an('object');
        expect(result.data.createUsers).to.be.an('object');
        expect(result.data.createUsers.nodes).to.be.an('array');
        expect(result.data.createUsers.nodes[0].newUser).to.be.an('object');
        expect(result.data.createUsers.nodes[0].newUser.id).to.be.an('string');

        expect(result.data.createUsers.nodes[0].newUser.email).to.be.equal(createUsersVariables.input.values[0].email);
        expect(result.data.createUsers.nodes[0].newUser.password).to.be.equal(createUsersVariables.input.values[0].password);

        // console.log('result.data.createUsers.nodes:', result.data.createUsers.nodes)
        cb();
      })
      .catch((error) => {
        cb(error);
      });
  })

  it('should successfully create records', function(cb) {

    var schema = getSchema(sequelize);

    let createUserMutation = `
      mutation createUserTest($input: createUserInput!) {
        createUser(input: $input) {
          newUser {
            id
            email
            password
          }
        }
      }
    `;
    let createUserVariables = {
      "input": {
        "email": `testuser${rand}@web.com`,
        "password": `password${rand}`,
        "clientMutationId": "test"
      }
    };

    
    let createTodoVariables = {
      "input": {
        "text": "Something",
        "completed": false,
        // userId,
        "clientMutationId": "test"
      }
    };
    let createTodoAssigneeVariables1 = {
      "input": {
        "primary": true,
        // "UserId": userId,
        // "TodoId": todoId,
        "clientMutationId": "test"
      }
    };
    // let createTodoAssigneeVariables2 = {
    //   "input": {
    //     "primary": false,
    //     "UserId": userId,
    //     "TodoId": todoId,
    //     "clientMutationId": "yo"
    //   }
    // };
    let userId, todoId;

    
    return graphql(schema, createUserMutation, {}, {}, createUserVariables)
      .then(result => {
        // console.log(JSON.stringify(result, undefined, 4));
        expect(result).to.be.an('object');
        expect(result.errors).to.be.equal(undefined, `An error occurred: ${result.errors}`);
        expect(result.data).to.be.an('object');
        expect(result.data.createUser).to.be.an('object');
        expect(result.data.createUser.newUser).to.be.an('object');
        expect(result.data.createUser.newUser.id).to.be.an('string');

        expect(result.data.createUser.newUser.email).to.be.equal(createUserVariables.input.email);
        expect(result.data.createUser.newUser.password).to.be.equal(createUserVariables.input.password);

        userId = result.data.createUser.newUser.id;

        let createTodoMutation = `
          mutation createTodoTest($input: createTodoInput!) {
            createTodo(input: $input) {
              newTodo {
                id
                text
                completed
              }
            }
          }
        `;
        createTodoVariables.input.userId = userId;

        return graphql(schema, createTodoMutation, {}, {}, createTodoVariables);
      })
      .then(result => {
        // console.log(JSON.stringify(result, undefined, 4));
        expect(result).to.be.an('object');
        expect(result.errors).to.be.equal(undefined, `An error occurred: ${result.errors}`);
        expect(result.data).to.be.an('object');
        expect(result.data.createTodo).to.be.an('object');
        expect(result.data.createTodo.newTodo).to.be.an('object');
        expect(result.data.createTodo.newTodo.id).to.be.an('string');

        expect(result.data.createTodo.newTodo.text).to.be.equal(createTodoVariables.input.text);
        expect(result.data.createTodo.newTodo.completed).to.be.equal(createTodoVariables.input.completed);

        todoId = result.data.createTodo.newTodo.id;

        let createTodoAssigneeMutation = `
          mutation createTodoAssigneeTest($input: createTodoAssigneeInput!) {
            createTodoAssignee(input: $input) {
              newTodoAssignee {
                id
                primary
              }
            }
          }
        `;
        createTodoAssigneeVariables1.input.UserId = userId;
        createTodoAssigneeVariables1.input.TodoId = todoId;

        return graphql(schema, createTodoAssigneeMutation, {}, {}, createTodoAssigneeVariables1)
      })
      .then(result => {
        // console.log(JSON.stringify(result, undefined, 4));
        expect(result).to.be.an('object');
        expect(result.errors).to.be.equal(undefined, `An error occurred: ${result.errors}`);
        expect(result.data).to.be.an('object');
        expect(result.data.createTodoAssignee).to.be.an('object');
        expect(result.data.createTodoAssignee.newTodoAssignee).to.be.an('object');
        expect(result.data.createTodoAssignee.newTodoAssignee.id).to.be.an('string');

        expect(result.data.createTodoAssignee.newTodoAssignee.primary).to.be.equal(createTodoAssigneeVariables1.input.primary);

        let queryUser = `query {
          todos {
            id
            text
            completed
          }
          todoAssignees {
            id
            primary
            UserId
            TodoId
          }
          users {
            id
            email
            todos {
              total
              edges {
                node {
                  id
                  text
                  completed
                }
              }
            }
            assignedTodos {
              total
              edges {
                id
                primary
                node {
                  id
                  text
                  completed
                }
              }
            }
          }
        }`;
        return graphql(schema, queryUser);
      })
      .then(result => {
        // console.log('result   123123:',JSON.stringify(result, false, 4))  
        expect(result).to.be.an('object');
        expect(result.data).to.be.an('object');

        expect(result.data.todoAssignees).to.be.an('array');
        expect(result.data.todoAssignees[0].id).to.be.an('string');

        expect(result.data.users).to.be.an('array');
        expect(result.data.users[0].id).to.be.an('string');

        expect(result.data.users[0].todos).to.be.an('object');
        expect(result.data.users[0].todos.edges).to.be.an('array');
        expect(result.data.users[0].todos.edges[0]).to.be.an('object');
        expect(result.data.users[0].todos.edges[0].node).to.be.an('object');

        expect(result.data.users[0].assignedTodos).to.be.an('object');
        expect(result.data.users[0].assignedTodos.total).to.be.an('number');
        expect(result.data.users[0].assignedTodos.edges).to.be.an('array');
        
        expect(result.data.users[0].assignedTodos.edges[0]).to.be.an('object');
        expect(result.data.users[0].assignedTodos.edges[0].id).to.be.an('string');
        expect(result.data.users[0].assignedTodos.edges[0].primary).to.be.an('boolean');
        expect(result.data.users[0].assignedTodos.edges[0].node).to.be.an('object');

        expect(result.data.users[0].assignedTodos.edges[0].primary).to.be.equal(true);
        expect(result.data.users[0].assignedTodos.edges[0].id).to.be.equal(result.data.todoAssignees[0].id);

        expect(result.data.users[0].assignedTodos.edges[0].node.id).to.be.an('string');
        expect(result.data.users[0].assignedTodos.edges[0].id).to.be.equal(result.data.todoAssignees[0].id);
        expect(result.data.users[0].assignedTodos.edges[0].node.id).to.be.equal(result.data.todos[0].id);
        expect(result.data.users[0].assignedTodos.edges[0].node.text).to.be.equal(createTodoVariables.input.text);
        expect(result.data.users[0].assignedTodos.edges[0].node.completed).to.be.equal(createTodoVariables.input.completed);

        cb();
      })
      .catch((error) => {
        cb(error);
      });

  });

  it('should successfully create and update single User record', function(cb) {

    var schema = getSchema(sequelize);

    let createUserMutation = `
      mutation createUserTest($input: createUserInput!) {
        createUser(input: $input) {
          newUser {
            id
            email
            password
          }
        }
      }
    `;
    let createUserVariables = {
      "input": {
        "email": `testuser${rand}@web.com`,
        "password": `password${rand}`,
        "clientMutationId": "test"
      }
    };
    let updateUserMutation = `
      mutation updateUserTest($input: updateUserInput!) {
        updateUser(input: $input) {
          updatedUser {
            id
            email
            password
          }
        }
      }
    `;
    let updateUserVariables = {
      "input": {
        "values": {
          "email": `testuser${rand+1}@web.com`,
          "password": `password${rand-1}`,
        },
        "clientMutationId": "test"
      }
    };

    let userId;

    return graphql(schema, createUserMutation, {}, {}, createUserVariables)
      .then(result => {
        // console.log(JSON.stringify(result, undefined, 4));
        expect(result).to.be.an('object');
        expect(result.data).to.be.an('object');
        expect(result.data.createUser).to.be.an('object');
        expect(result.data.createUser.newUser).to.be.an('object');
        expect(result.data.createUser.newUser.id).to.be.an('string');

        userId = result.data.createUser.newUser.id;
        updateUserVariables.input.id = userId;

        // console.log(updateUserVariables);
        return graphql(schema, updateUserMutation, {}, {}, updateUserVariables);
      })
      .then(result => {
        // console.log(JSON.stringify(result, undefined, 4));
        expect(result).to.be.an('object');
        expect(result.data).to.be.an('object');
        expect(result.data.updateUser).to.be.an('object');
        expect(result.data.updateUser.updatedUser).to.be.an('object');
        expect(result.data.updateUser.updatedUser.id).to.be.an('string');
        expect(result.data.updateUser.updatedUser.email).to.be.an('string');
        expect(result.data.updateUser.updatedUser.password).to.be.an('string');

        expect(result.data.updateUser.updatedUser.id).to.be.equal(updateUserVariables.input.id);
        expect(result.data.updateUser.updatedUser.email).to.be.equal(updateUserVariables.input.values.email);
        expect(result.data.updateUser.updatedUser.password).to.be.equal(updateUserVariables.input.values.password);

        cb();
      })
      .catch((error) => {
        cb(error);
      });

  });


  it('should successfully create and update User records', function(cb) {

    var schema = getSchema(sequelize);

    let createUserMutation = `
      mutation createUserTest($input: createUserInput!) {
        createUser(input: $input) {
          newUser {
            id
            email
            password
          }
        }
      }
    `;
    let createUserVariables = {
      "input": {
        "email": `testuser${rand}@web.com`,
        "password": `password${rand}`,
        "clientMutationId": "test"
      }
    };
    let updateUsersMutation = `
      mutation updateUsersTest($input: updateUsersInput!) {
        updateUsers(input: $input) {
          affectedCount
          nodes {
            newUser {
              id
              email
              password
            }
          }
        }
      }
    `;
    let updateUsersVariables = {
      "input": {
        "values": {
          "email": `testuser${rand+1}@web.com`,
          "password": `password${rand+1}`,
        },
        "where": {},
        "clientMutationId": "test"
      }
    };

    let userId;

    return graphql(schema, createUserMutation, {}, {}, createUserVariables)
      .then(result => {
        // console.log(JSON.stringify(result, undefined, 4));
        expect(result).to.be.an('object');
        expect(result.data).to.be.an('object');
        expect(result.data.createUser).to.be.an('object');
        expect(result.data.createUser.newUser).to.be.an('object');
        expect(result.data.createUser.newUser.id).to.be.an('string');

        userId = result.data.createUser.newUser.id;
        updateUsersVariables.input.where.id = userId;

        // console.log(updateUserVariables);
        return graphql(schema, updateUsersMutation, {}, {}, updateUsersVariables);
      })
      .then(result => {
        // console.log(result, JSON.stringify(result, undefined, 4));
        expect(result).to.be.an('object');
        expect(result.data).to.be.an('object');
        expect(result.data.updateUsers).to.be.an('object');
        expect(result.data.updateUsers.nodes).to.be.an('array');
        expect(result.data.updateUsers.affectedCount).to.be.equal(1);
        expect(result.data.updateUsers.nodes.length).to.be.equal(1);
        expect(result.data.updateUsers.nodes[0]).to.be.an('object');
        expect(result.data.updateUsers.nodes[0].newUser).to.be.an('object');
        expect(result.data.updateUsers.nodes[0].newUser.id).to.be.an('string');
        expect(result.data.updateUsers.nodes[0].newUser.email).to.be.an('string');
        expect(result.data.updateUsers.nodes[0].newUser.password).to.be.an('string');

        expect(result.data.updateUsers.nodes[0].newUser.email).to.be.equal(updateUsersVariables.input.values.email);
        expect(result.data.updateUsers.nodes[0].newUser.password).to.be.equal(updateUsersVariables.input.values.password);

        cb();
      })
      .catch((error) => {
        cb(error);
      });

  });

  it('should successfully create and delete User records', function(cb) {

    var schema = getSchema(sequelize);

    let createUserMutation = `
      mutation createUserTest($input: createUserInput!) {
        createUser(input: $input) {
          newUser {
            id
            email
            password
          }
        }
      }
    `;
    let createUserVariables = {
      "input": {
        "email": `testuser${rand}@web.com`,
        "password": `password${rand}`,
        "clientMutationId": "test"
      }
    };
    let deleteUsersMutation = `
      mutation deleteUsersTest($input: deleteUsersInput!) {
        deleteUsers(input: $input) {
          affectedCount
        }
      }
    `;
    let deleteUsersVariables = {
      "input": {
        "where": {},
        "clientMutationId": "test"
      }
    };

    let userId;

    return graphql(schema, createUserMutation, {}, {}, createUserVariables)
      .then(result => {
        // console.log(JSON.stringify(result, undefined, 4));
        expect(result).to.be.an('object');
        expect(result.data).to.be.an('object');
        expect(result.data.createUser).to.be.an('object');
        expect(result.data.createUser.newUser).to.be.an('object');
        expect(result.data.createUser.newUser.id).to.be.an('string');

        userId = result.data.createUser.newUser.id;
        deleteUsersVariables.input.where.id = userId;

        // console.log(updateUserVariables);
        return graphql(schema, deleteUsersMutation, {}, {}, deleteUsersVariables);
      })
      .then(result => {
        // console.log(result);
        // console.log(JSON.stringify(result, undefined, 4));
        expect(result).to.be.an('object');
        expect(result.data).to.be.an('object');
        expect(result.data.deleteUsers).to.be.an('object');
        // expect(result.data.deleteUsers.nodes).to.be.an('array');
        // expect(result.data.deleteUsers.affectedCount).to.be.equal(1);
        // expect(result.data.deleteUsers.nodes.length).to.be.equal(1);
        // expect(result.data.deleteUsers.nodes[0]).to.be.an('object');
        // expect(result.data.deleteUsers.nodes[0].newUser).to.be.an('object');
        // expect(result.data.deleteUsers.nodes[0].newUser.id).to.be.an('string');
        // expect(result.data.deleteUsers.nodes[0].newUser.email).to.be.an('string');
        // expect(result.data.deleteUsers.nodes[0].newUser.password).to.be.an('string');
        //
        // expect(result.data.deleteUsers.nodes[0].newUser.email).to.be.equal(updateUserVariables.input.values.email);
        // expect(result.data.deleteUsers.nodes[0].newUser.password).to.be.equal(updateUserVariables.input.values.password);

        cb();
      })
      .catch((error) => {
        cb(error);
      });

  });

  it('should successfully create and delete single User record', function(cb) {

    var schema = getSchema(sequelize);

    let createUserMutation = `
      mutation createUserTest($input: createUserInput!) {
        createUser(input: $input) {
          newUser {
            id
            email
            password
          }
        }
      }
    `;
    let createUserVariables = {
      "input": {
        "email": `testuser${rand}@web.com`,
        "password": `password${rand}`,
        "clientMutationId": "test"
      }
    };
    let deleteUserMutation = `
      mutation deleteUserTest($input: deleteUserInput!) {
        deleteUser(input: $input) {
          deletedUserId
        }
      }
    `;
    let deleteUserVariables = {
      "input": {
        "clientMutationId": "test"
      }
    };

    let userId;

    return graphql(schema, createUserMutation, {}, {}, createUserVariables)
      .then(result => {
        // console.log(JSON.stringify(result, undefined, 4));
        expect(result).to.be.an('object');
        expect(result.data).to.be.an('object');
        expect(result.data.createUser).to.be.an('object');
        expect(result.data.createUser.newUser).to.be.an('object');
        expect(result.data.createUser.newUser.id).to.be.an('string');

        userId = result.data.createUser.newUser.id;
        deleteUserVariables.input.id = userId;

        // console.log(updateUserVariables);
        return graphql(schema, deleteUserMutation, {}, {}, deleteUserVariables);
      })
      .then(result => {
        // console.log(result);
        // console.log(JSON.stringify(result, undefined, 4));
        expect(result).to.be.an('object');
        expect(result.data).to.be.an('object');
        expect(result.data.deleteUser).to.be.an('object');
        expect(result.data.deleteUser.deletedUserId).to.be.a('string');
        expect(result.data.deleteUser.deletedUserId).to.be.equal(deleteUserVariables.input.id);
        // expect(result.data.deleteUsers.nodes.length).to.be.equal(1);
        // expect(result.data.deleteUsers.nodes[0]).to.be.an('object');
        // expect(result.data.deleteUsers.nodes[0].newUser).to.be.an('object');
        // expect(result.data.deleteUsers.nodes[0].newUser.id).to.be.an('string');
        // expect(result.data.deleteUsers.nodes[0].newUser.email).to.be.an('string');
        // expect(result.data.deleteUsers.nodes[0].newUser.password).to.be.an('string');
        //
        // expect(result.data.deleteUsers.nodes[0].newUser.email).to.be.equal(updateUserVariables.input.values.email);
        // expect(result.data.deleteUsers.nodes[0].newUser.password).to.be.equal(updateUserVariables.input.values.password);

        cb();
      })
      .catch((error) => {
        cb(error);
      });

  });


});