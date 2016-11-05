var levelup = require('levelup')

module.exports.setUp = function (leveldown, test, testCommon) {
  test('setUp common', testCommon.setUp)
  test('setUp db', function (t) {
    db = leveldown(testCommon.location())
    db.open(t.end.bind(t))
  })
}

module.exports.all = function(leveljs, tape, testCommon) {

  module.exports.setUp(leveljs, tape, testCommon)

  tape('should call next async', function(t) {
    var level = leveljs(testCommon.location())
    level.open(function(err) {
      t.notOk(err, 'no error')
      level.put('a', 'a',  function (err) {
        t.notOk(err, 'no error')

        var iterator = level.iterator({ keyAsBuffer: false, valueAsBuffer: false, reopenOnTimeout: true })

        var i = 0
        // give the cursor of the iterator some time to get to the first item so that next can call back right away
        setTimeout(function() {
          iterator.next(function(err, key, value) {
            t.notOk(err, 'no error')
            t.equal(key, 'a', 'key a')
            t.equal(value, 'a', 'value a')

            t.equal(i, 1, 'should call next async')
            t.end()
          })
          i++
        }, 5)
      })
    })
  })

  tape('should not timeout if next is called fast enough', function(t) {
    var level = leveljs(testCommon.location())
    level.open(function(err) {
      t.notOk(err, 'no error')
      level.put('a', 'a',  function (err) {
        t.notOk(err, 'no error')
        level.put('b', 'b',  function (err) {
          t.notOk(err, 'no error')

          var iterator = level.iterator({ keyAsBuffer: false, valueAsBuffer: false })

          // call next in the callback of the previous call to next

          iterator.next(function(err, key, value) {
            t.notOk(err, 'no error')
            t.equal(key, 'a', 'key a')
            t.equal(value, 'a', 'value a')

            // call next right away
            iterator.next(function(err, key, value) {
              t.notOk(err, 'no error')
              t.equal(key, 'b', 'key b')
              t.equal(value, 'b', 'value b')

              // call next right away
              iterator.next(function(err, key, value) {
                t.notOk(err, 'no error')
                t.notOk(key, 'should have no key')
                t.notOk(value, 'should have no value')
                t.end()
              })
            })
          })
        })
      })
    })
  })

  tape('should timeout if next is not called fast enough (async)', function(t) {
    // Note: Safari can sometimes be less aggressive about killing the cursor and a timeout may not always occur
    var level = leveljs(testCommon.location())
    level.open(function(err) {
      t.notOk(err, 'no error')
      level.put('a', 'a',  function (err) {
        t.notOk(err, 'no error')
        level.put('b', 'b',  function (err) {
          t.notOk(err, 'no error')

          var iterator = level.iterator({ keyAsBuffer: false, valueAsBuffer: false })

          iterator.next(function(err, key, value) {
            t.notOk(err, 'no error')
            t.equal(key, 'a', 'should have a key')
            t.equal(value, 'a', 'should have a value')

            process.nextTick(function() {
              iterator.next(function(err, key, value) {
                t.equal(err && err.name, 'TransactionInactiveError', 'should have a timeout error')
                t.equal(iterator._cursorsStarted, 1, 'should not have reopened the cursor')
                t.end()
              })
            })
          })
        })
      })
    })
  })

  tape('should not timeout with reopenOnTimeout = true', function(t) {
    var level = leveljs(testCommon.location())
    level.open(function(err) {
      t.notOk(err, 'no error')
      level.put('akey', 'aval',  function (err) {
        t.notOk(err, 'no error')
        level.put('bkey', 'bval',  function (err) {
          t.notOk(err, 'no error')
          level.put('ckey', 'cval',  function (err) {
            t.notOk(err, 'no error')

            var iterator = level.iterator({ keyAsBuffer: false, valueAsBuffer: false, reopenOnTimeout: true })

            iterator.next(function(err, key, value) {
              t.notOk(err, 'no error')
              t.equal(key, 'akey', 'key a')
              t.equal(value, 'aval', 'value a')

              setTimeout(function() {
                iterator.next(function(err, key, value) {
                  t.notOk(err, 'no error')
                  t.equal(key, 'bkey', 'value b')
                  t.equal(value, 'bval', 'value b')

                  setTimeout(function() {
                    iterator.next(function(err, key, value) {
                      t.notOk(err, 'no error')
                      t.equal(key, 'ckey', 'value c')
                      t.equal(value, 'cval', 'value c')

                      setTimeout(function() {
                        iterator.next(function(err, key, value) {
                          t.notOk(err, 'no error')
                          t.notOk(key, 'end, no key')
                          t.notOk(value, 'end, no value')
                          t.equal(iterator._cursorsStarted, 3, 'should have reopened the cursor three times')
                          t.end()
                        })
                      }, 5)
                    })
                  }, 5)
                })
              }, 5) // Safari can sometimes be less aggressive about killing the cursor
            })
          })
        })
      })
    })
  })

  tape('throw if trying to convert Uint16Array to Buffer', function (t) {
    var key = 'uint16array'
    var value = new Uint16Array([257])
    var level = leveljs(testCommon.location())
    level.open(function(err) {
      t.notOk(err, 'no error')
      level.put(key, value, function (err) {
        t.notOk(err, 'no error')
        level.get(key, function (err, _value) {
          t.equal(err.message, 'can\'t coerce `Uint16Array` into a Buffer')
          level.close(function(err) {
            t.notOk(err, 'no error')
            t.end()
          })
        })
      })
    })
  })

  tape('get native JS types with asBuffer = false', function(t) {
    var level = leveljs(testCommon.location())
    level.open(function(err) {
      t.notOk(err, 'no error')
      level.put('key', true, function (err) {
        t.notOk(err, 'no error')
        level.get('key', { asBuffer: false }, function(err, value) {
          t.notOk(err, 'no error')
          t.ok(typeof value === 'boolean', 'is boolean type')
          t.ok(value, 'is truthy')
          level.close(function(err) {
            t.notOk(err, 'no error')
            t.end()
          })
        })
      })
    })
  })

  // NOTE: in chrome (at least) indexeddb gets buggy if you try and destroy a db,
  // then create it again, then try and destroy it again. these avoid doing that

  tape('test levelup .destroy w/ string', function(t) {
    var level = levelup('destroy-test', {db: leveljs})
    level.put('key', 'value', function (err) {
      t.notOk(err, 'no error')
      level.get('key', function (err, value) {
        t.notOk(err, 'no error')
        t.equal(value, 'value', 'should have value')
        level.close(function (err) {
          t.notOk(err, 'no error')
          leveljs.destroy('destroy-test', function (err) {
            t.notOk(err, 'no error')
            var level2 = levelup('destroy-test', {db: leveljs})
            level2.get('key', function (err, value) {
              t.ok(err, 'key is not there')
              t.end()
            })
          })
        })
      })
    })
  })

  tape('test levelup .destroy w/ db instance', function(t) {
    var level = levelup('destroy-test-2', {db: leveljs})
    level.put('key', 'value', function (err) {
      t.notOk(err, 'no error')
      level.get('key', function (err, value) {
        t.notOk(err, 'no error')
        t.equal(value, 'value', 'should have value')
        level.close(function (err) {
          t.notOk(err, 'no error')
          leveljs.destroy(level, function (err) {
            t.notOk(err, 'no error')
            var level2 = levelup('destroy-test-2', {db: leveljs})
            level2.get('key', function (err, value) {
              t.ok(err, 'key is not there')
              t.end()
            })
          })
        })
      })
    })
  })

  tape('zero results if gt key > lt key', function(t) {
    var level = levelup('key-range-test', {db: leveljs})
    level.open(function(err) {
      t.notOk(err, 'no error')
      var s = level.createReadStream({ gte: 'x', lt: 'b' });
      var item;
      s.on('readable', function() {
        item = s.read()
      })
      s.on('end', function() {
        t.end()
      });
    })
  })

  tape.only('stringify buffer keys', function (t) {
    var level = levelup('buf-key-test', {db: leveljs, keyEncoding:'binary'})
    var key = new Buffer('hey')
    var val = 'ho'
    level.put(key, val, function (err) {
      t.error(err)
      level.get(key, function (err, storedVal) {
        t.error(err)
        t.equal(storedVal, val)
        var s = level.createReadStream()//{ gte: 'h', lt: 'hf' });
        s.on('data', function(data) {
          t.same(data, { key: key, value: val })
        })
        s.on('end', function() {
          t.end()
        })
      })
    })
  })
}
