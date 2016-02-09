var util = require('util')
var AbstractIterator  = require('abstract-leveldown').AbstractIterator
var ltgt = require('ltgt')

module.exports = Iterator

/**
 * Open IndexedDB cursor.
 *
 * @param {Object} db  db instance
 * @param {Object} [options]  options
 *
 * options:
 *   reopenOnTimeout {Boolean}  Reopen a new cursor if it times out. This can
 *                              happen if _next is not called fast enough. Every
 *                              time the cursor is reopened it operates on a new
 *                              snapshot of the database. This option is false
 *                              by default.
 */
function Iterator(db, options) {
  this._db = db._db
  this._idbOpts = db._idbOpts

  if (options == null) options = {}

  AbstractIterator.call(this, db)

  this._limit = options.limit;
  if (this._limit == null || this._limit === -1) {
    this._limit = Infinity;
  }
  if (typeof this._limit !== 'number') throw new TypeError('options.limit must be a number')
  if (this._limit === 0) return // skip further processing and wait for first call to _next

  this._reopenOnTimeout = !!options.reopenOnTimeout

  this._count = 0
  this._cursorsStarted = 0
  this._lastIteratedKey = null

  this._startCursor(options)
}

util.inherits(Iterator, AbstractIterator)

Iterator.prototype._startCursor = function(options) {
  var keyRange = null
  var lower = ltgt.lowerBound(options)
  var upper = ltgt.upperBound(options)
  var lowerOpen = ltgt.lowerBoundExclusive(options)
  var upperOpen = ltgt.upperBoundExclusive(options)

  var direction = options.reverse ? 'prev': 'next'

  // if this is not the first iteration, use lastIteratedKey
  if (this._lastIteratedKey) {
    if (direction === 'next') {
      lowerOpen = true
      lower = this._lastIteratedKey
    } else {
      upperOpen = true
      upper = this._lastIteratedKey
    }
  }

  if (lower && upper)
    try {
      keyRange = IDBKeyRange.bound(lower, upper, lowerOpen, upperOpen)
    } catch (err) {
      // skip the iterator and return 0 results if IDBKeyRange throws a DataError (if keys overlap)
      this._keyRangeError = true
      return;
    }
  else if (lower)
    keyRange = IDBKeyRange.lowerBound(lower, lowerOpen)
  else if (upper)
    keyRange = IDBKeyRange.upperBound(upper, upperOpen)

  var tx = this._db.transaction(this._idbOpts.storeName)
  var req = tx.objectStore(this._idbOpts.storeName).openCursor(keyRange, direction)

  this._cursorsStarted++

  var self = this

  tx.onabort = function() {
    if (self._callback) {
      var cb = self._callback
      self._callback = false
      cb(tx.error)
    } else  {
      // ensure a next handler, overwrite if necessary
      self._nextHandler = function(cb) {
        cb(tx.error)
      }
    }
  }

  // register a next handler, only call it directly if a callback is registered
  req.onsuccess = function() {
    if (self._nextHandler) throw new Error('nextHandler already exists')

    var cursor = req.result

    if (cursor) {
      var key = cursor.key
      var value = cursor.value

      self._lastIteratedKey = key

      if (options.keyAsBuffer && !Buffer.isBuffer(key)) {
        if (key == null)                     key = new Buffer(0)
        else if (typeof key === 'string')    key = new Buffer(key) // defaults to utf8, should the encoding be utf16? (DOMString)
        else if (typeof key === 'boolean')   key = new Buffer(String(key)) // compatible with leveldb
        else if (typeof key === 'number')    key = new Buffer(String(key)) // compatible with leveldb
        else if (Array.isArray(key))         key = new Buffer(String(key)) // compatible with leveldb
        else if (key instanceof Uint8Array)  key = new Buffer(key)
        else throw new TypeError('can\'t coerce `' + key.constructor.name + '` into a Buffer')
      }

      if (options.valueAsBuffer && !Buffer.isBuffer(value)) {
        if (value == null)                     value = new Buffer(0)
        else if (typeof value === 'string')    value = new Buffer(value) // defaults to utf8, should the encoding be utf16? (DOMString)
        else if (typeof value === 'boolean')   value = new Buffer(String(value)) // compatible with leveldb
        else if (typeof value === 'number')    value = new Buffer(String(value)) // compatible with leveldb
        else if (Array.isArray(value))         value = new Buffer(String(value)) // compatible with leveldb
        else if (value instanceof Uint8Array)  value = new Buffer(value)
        else throw new TypeError('can\'t coerce `' + value.constructor.name + '` into a Buffer')
      }

      if (self._count++ < self._limit) {
        // emit this item, unless the cursor gives a timeout error
        self._nextHandler = function(cb) {
          if (self._ended) {
            cb(null, key, value)
          } else { // only continue the cursor if the stream is not ended by the user
            try {
              cursor.continue() // throws a TransactionInactiveError if the cursor timed out
              cb(null, key, value)
            } catch(err) {
              // either reopen and emit the current cursor value or propagate the error
              if (err.name === 'TransactionInactiveError' && self._reopenOnTimeout) {
                cb(null, key, value)
                self._startCursor(options) // indexedDB timed out the cursor
              } else cb(err)
            }
          }
        }
      } else { // limit reached, finish and let the cursor timeout
        self._nextHandler = function(cb) { cb() }
      }
    } else { // end of cursor reached, finish
      self._nextHandler = function(cb) { cb() }
    }

    if (self._callback) {
      // fix state before calling the callback since the callback itself might invoke a new call to next synchronously
      var nh = self._nextHandler.bind(self)
      var cb = self._callback
      self._nextHandler = false
      self._callback = false
      nh(cb) // since this is async compared to when the callback was registered, call it synchronously
    }
  }
}

// register a callback, only call it directly if a nextHandler is registered
Iterator.prototype._next = function(callback) {
  if (this._callback) throw new Error('callback already exists') // each callback should be invoked exactly once
  if (this._keyRangeError || this._limit === 0) return void callback()

  this._callback = callback

  if (this._nextHandler) {
    var nh = this._nextHandler.bind(nh)
    this._nextHandler = false
    this._callback = false
    // nextHandler is sync, cb should be invoked async
    process.nextTick(function() {
      nh(callback)
    })
  }
}
