const _ = require("lodash");

export default function condenseAssociations(associationNames, path, associations, data) {
  if (!data) return;
  if (!associationNames) associationNames = {}
  const dataArray = Array.isArray(data) ? data : [data]; //convert any data objects to arrays so everything is handled identically
  _.each(associations, function(association, akey) {
    const pathToUse = path ? path + "." + akey : akey
    dataArray.forEach(function(data) {
      if (data[akey]) {

        var subNames = _.get(associationNames, pathToUse, {});
        _.set(associationNames, pathToUse, {
          ...subNames
        });
        condenseAssociations(
          associationNames,
          pathToUse,
          association.target.associations,
          data[akey]
        );
      }
    });
  });
}

