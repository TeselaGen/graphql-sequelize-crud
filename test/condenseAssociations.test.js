import condenseAssociations from '../src/condenseAssociations';
var expect = require('chai').expect;

describe("condenseAssociations", function() {
  it("should condense nested associations correctly", function() {
    var data = {
      email: "yup",
      password: "ygg",
      todos: [
        {
          text: "hippy",
          completed: true,
          todonotes: [
            {
              text: "dippy"
            },
            {
              text: "yup"
            }
          ]
        },
        {
          text: "hippy",
          completed: true,
          likedBy: [
            {
              username: "chad"
            }
          ],
          todonotes: [
            {
              text: "dippy"
            },
            {
              text: "yup",
              likedBy: [
                {
                  username: "thomas"
                }
              ]
            }
          ]
        }
      ]
    };

    var associations = {
      todos: {
        target: {
          associations: {
            todonotes: {
              target: {
                associations: {
                  likedBy: {
                    target: {
                      associations: {}
                    }
                  }
                }
              }
            },
            likedBy: {
              target: {
                associations: {}
              }
            }
          }
        }
      }
    };

    var associationNames = {};
    condenseAssociations(associationNames, undefined, associations, data);
    expect(associationNames).to.deep.equal({
      todos: {
        likedBy: {},
        todonotes: {
          likedBy: {}
        }
      }
    });
  });
});
