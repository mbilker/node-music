var util = require('util');
var cache = require('./cache.json');

console.log(util.inspect(cache, { depth: null, colors: true }));
