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

Level.prototype._get = function(key, options, callback) {
  var tx = this._db.transaction(this._idbOpts.storeName)
  var req = tx.objectStore(this._idbOpts.storeName).openCursor(IDBKeyRange.only(key))

  tx.onabort = function() {
    callback(tx.error)
  }

  req.onsuccess = function() {
    var cursor = req.result
    if (cursor) {
      var value = cursor.value
      if (options.asBuffer && !Buffer.isBuffer(value)) {
        if (value == null)                     value = new Buffer(0)
        else if (typeof value === 'string')    value = new Buffer(value) // defaults to utf8, should the encoding be utf16? (DOMString)
        else if (typeof value === 'boolean')   value = new Buffer(String(value)) // compatible with leveldb
        else if (typeof value === 'number')    value = new Buffer(String(value)) // compatible with leveldb
        else if (Array.isArray(value))         value = new Buffer(String(value)) // compatible with leveldb
        else if (value instanceof Uint8Array)  value = new Buffer(value)
        else return void callback(new TypeError('can\'t coerce `' + value.constructor.name + '` into a Buffer'))
      }
      return void callback(null, value, key)
    } else {
      // 'NotFound' error, consistent with LevelDOWN API
      return void callback(new Error('NotFound'))
    }
  }
}

Level.prototype._del = function(key, options, callback) {
  var mode = 'readwrite'
  if (options.sync === true) {
    mode = 'readwriteflush' // only supported in Firefox (with "dom.indexedDB.experimental" pref set to true)
  }
  var tx = this._db.transaction(this._idbOpts.storeName, mode)
  var req = tx.objectStore(this._idbOpts.storeName).delete(key)

  tx.onabort = function() {
    callback(tx.error)
  }

  tx.oncomplete = function() {
    callback()
  }
}

Level.prototype._put = function(key, value, options, callback) {
  var mode = 'readwrite'
  if (options.sync === true) {
    mode = 'readwriteflush' // only supported in Firefox (with "dom.indexedDB.experimental" pref set to true)
  }
  var tx = this._db.transaction(this._idbOpts.storeName, mode)
  var req = tx.objectStore(this._idbOpts.storeName).put(value, key)

  tx.onabort = function() {
    callback(tx.error)
  }

  tx.oncomplete = function() {
    callback()
  }
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

// only support sync: true on batch level, not operation level
Level.prototype._batch = function(array, options, callback) {
  if (array.length === 0) return process.nextTick(callback)

  var mode = 'readwrite'
  if (options.sync === true) {
    mode = 'readwriteflush' // only supported in Firefox (with "dom.indexedDB.experimental" pref set to true)
  }
  var tx = this._db.transaction(this._idbOpts.storeName, mode)
  var store = tx.objectStore(this._idbOpts.storeName)

  tx.onabort = function() {
    callback(tx.error)
  }

  tx.oncomplete = function() {
    callback()
  }

  array.forEach(function(currentOp) {
    if (currentOp.type === 'del') {
      store.delete(currentOp.key)
    } else {
      store.put(currentOp.value, currentOp.key)
    }
  })
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
