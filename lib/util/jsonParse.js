/**
 * Created by cuccpkfs on 15-3-9.
 */

var _ = require('underscore');

module.exports = function(text){
  var data = JSON.parse(text)
    , obj = {}
    ;
  if (data instanceof Array) {
    var arr = data
      , keys = Object.keys(arr[0])
      ;
    for (var i = 0, len = keys.length; i < len; i++) {
      var key = keys[i];
      obj[key] = _.map(_.pluck(arr, key), encodeURIComponent);
    }
  } else {
    // object
    var keys = Object.keys(data);
    for (var i = 0, len = keys.length; i < len; i++) {
      var key = keys[i];
      obj[key] = encodeURIComponent(data[key]);
    }
  }
  return obj;
};