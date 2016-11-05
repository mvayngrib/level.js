
var d64 = require('d64')
var BINARY_PREFIX = 'Buf:'
var noBinaryKeys = (function isIE () {
  var ua = global.navigator.userAgent
  var msie = ua.indexOf("MSIE ")
  // IE<11
  if (msie > 0) return true

  // IE11
  return !(global.ActiveXObject) && 'ActiveXObject' in global
})()

module.exports = {
  normalizeKey: normalizeKey,
  denormalizeKey: denormalizeKey
}

function normalizeKey (opts, key) {
  if (opts.keyEncoding === 'binary') {
    if (noBinaryKeys) {
      return key instanceof Uint8Array || key instanceof ArrayBuffer ? BINARY_PREFIX + d64.encode(key) : key
    } else if (!Array.isArray(key)) {
      return Array.prototype.slice.call(key)
    }
  }

  return key
}

function denormalizeKey (opts, key) {
  if ((opts.keyEncoding === 'binary' || opts.keyAsBuffer) && typeof key === 'string') {
    if (noBinaryKeys) {
      return key.indexOf(BINARY_PREFIX) === 0 ? d64.decode(key.slice(BINARY_PREFIX.length)) : key
    } else {
      return new Buffer(key)
    }
  }

  return key
}

// function toArray (buf) {
//   var arr = []
//   for (var i = 0; i < buf.length; i++) arr[i] = buf[i]
//   return buf
// }
