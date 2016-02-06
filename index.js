module.exports = Level

var IDB = require('idb-wrapper')
var AbstractLevelDOWN = require('abstract-leveldown').AbstractLevelDOWN
var util = require('util')
var Iterator = require('./iterator')
var isBuffer = require('isbuffer')
var xtend = require('xtend')
var toBuffer = require('typedarray-to-buffer')

function Level(location) {
  if (!(this instanceof Level)) return new Level(location)

  AbstractLevelDOWN.call(this, location)
}

util.inherits(Level, AbstractLevelDOWN)

/**
 * Open a database and optionally create if missing.
 *
 * @param {Object} [options]  storeName and other options passed to indexedDB
 *                            open and createObjectStore.
 * @param {Function} callback  First parameter will be an error object or null.
 */
Level.prototype._open = function(options, callback) {
  var self = this

  // assume createIfMissing and errorIfExists are initialized by abstract-leveldown
  this._idbOpts = xtend({
    storeName: this.location
  }, options)

  var req = indexedDB.open(this.location) // use the databases current version

  req.onerror = function(ev) {
    callback(ev.target.error)
  }

  // if the store does not exist and createIfMissing is true, create the object store
  req.onsuccess = function() {
    self._db = req.result

    var exists = self._db.objectStoreNames.contains(self._idbOpts.storeName)

    if (options.errorIfExists && exists) {
      self._db.close()
      callback(new Error('store already exists'))
      return
    }

    if (!options.createIfMissing && !exists) {
      self._db.close()
      callback(new Error('store does not exist'))
      return
    }

    if (options.createIfMissing && !exists) {
      self._db.close()

      var req2 = indexedDB.open(self.location, self._db.version + 1)

      req2.onerror = function(ev) {
        callback(ev.target.error)
      }

      req2.onupgradeneeded = function() {
        var db = req2.result
        db.createObjectStore(self._idbOpts.storeName, self._idbOpts)
      }

      req2.onsuccess = function() {
        self._db = req2.result
        callback(null, self)
      }

      return
    }

    callback(null, self)
  }
}

Level.prototype._get = function (key, options, callback) {
  // should differentiatie between undefined values and "not found"
  var found, value;
  function onEnd() {
    if (!found) {
      // 'NotFound' error, consistent with LevelDOWN API
      return callback(new Error('NotFound'))
    }
    // by default return buffers, unless explicitly told not to
    var asBuffer = true
    if (options.asBuffer === false) asBuffer = false
    if (options.raw) asBuffer = false
    if (asBuffer) {
      if (value instanceof Uint8Array) value = toBuffer(value)
      else if (value == null) value = new Buffer(0)
      else value = new Buffer(String(value))
    }
    return callback(null, value, key)
  };
  var opts = {
    keyRange: key,
    onEnd: onEnd,
    onError: callback
  };
  this.idb.iterate(function(item) {
    found = true;
    value = item;
  }, opts);
}

Level.prototype._del = function(id, options, callback) {
  this.idb.remove(id, callback, callback)
}

Level.prototype._put = function (key, value, options, callback) {
  if (value instanceof ArrayBuffer) {
    value = toBuffer(new Uint8Array(value))
  }
  var obj = this.convertEncoding(key, value, options)
  if (Buffer.isBuffer(obj.value)) {
    obj.value = new Uint8Array(value.toArrayBuffer())
  }
  this.idb.put(obj.key, obj.value, function() { callback() }, callback)
}

Level.prototype.convertEncoding = function(key, value, options) {
  if (options.raw) return {key: key, value: value}
  if (value) {
    var stringed = value.toString()
    if (stringed === 'NaN') value = 'NaN'
  }
  var valEnc = options.valueEncoding
  var obj = {key: key, value: value}
  if (value && (!valEnc || valEnc !== 'binary')) {
    if (typeof obj.value !== 'object') {
      obj.value = stringed
    }
  }
  return obj
}

Level.prototype._iterator = function (options) {
  return new Iterator(this.idb, options)
}

Level.prototype._batch = function (array, options, callback) {
  var op
  var i
  var k
  var copiedOp
  var currentOp
  var modified = []
  
  if (array.length === 0) return setTimeout(callback, 0)
  
  for (i = 0; i < array.length; i++) {
    copiedOp = {}
    currentOp = array[i]
    modified[i] = copiedOp
    
    var converted = this.convertEncoding(currentOp.key, currentOp.value, options)
    currentOp.key = converted.key
    currentOp.value = converted.value

    for (k in currentOp) {
      if (k === 'type' && currentOp[k] == 'del') {
        copiedOp[k] = 'remove'
      } else {
        copiedOp[k] = currentOp[k]
      }
    }
  }

  return this.idb.batch(modified, function(){ callback() }, callback)
}

Level.prototype._close = function (callback) {
  this._db.close()
  process.nextTick(callback)
}

Level.prototype._approximateSize = function (start, end, callback) {
  var err = new Error('Not implemented')
  if (callback)
    return callback(err)

  throw err
}

Level.prototype._isBuffer = function (obj) {
  return Buffer.isBuffer(obj)
}

Level.destroy = function (db, callback) {
  if (typeof db === 'object') {
    var prefix = db.IDBOptions.storePrefix || 'IDBWrapper-'
    var dbname = db.location
  } else {
    var prefix = 'IDBWrapper-'
    var dbname = db
  }
  var request = indexedDB.deleteDatabase(prefix + dbname)
  request.onsuccess = function() {
    callback()
  }
  request.onerror = function(err) {
    callback(err)
  }
}

var checkKeyValue = Level.prototype._checkKeyValue = function (obj, type) {
  if (obj === null || obj === undefined)
    return new Error(type + ' cannot be `null` or `undefined`')
  if (obj === null || obj === undefined)
    return new Error(type + ' cannot be `null` or `undefined`')
  if (isBuffer(obj) && obj.byteLength === 0)
    return new Error(type + ' cannot be an empty ArrayBuffer')
  if (String(obj) === '')
    return new Error(type + ' cannot be an empty String')
  if (obj.length === 0)
    return new Error(type + ' cannot be an empty Array')
}
