(function(Firebase) {
  var root = this
  root.Utalk = Utalk

  function Utalk(firebaseRef, delegate, options) {
    this._firebase = firebaseRef
    this._delegate = delegate
    this._options = options || {}

    this._roomsRef = this._firebase.child('rooms')
    this._roomRef = null
    this._inputRef = null
    this._outputRef = null
    this._amHost = false
    this._running = false
    this._text = ""
    this._dmp = new diff_match_patch()
    this._queue = []
    this._queueBusy = false
  };

  Utalk.prototype = {
    _finish: function() {
      this._running = false
      this._text = ""
      this._delegate.text(this._text)
      this._delegate.finish()
    },

    _onThem: function(snapshot) {
      if (snapshot.val() === null) {
        if (this._running) {
          this._finish()
        }
      } else {
        if (this._amHost) {
          this._start()
        }
      }
    },

    _start: function() {
      this._running = true
      this._delegate.start()
      this._inputRef.on('child_added', this._onInput, this)
    },

    _applyDiffs: function(diffs) {
      var offset = 0
      var newText = ""
      for (var i in diffs) {
        var diff = diffs[i]
        switch (diff[0]) {
          case 0:
            newText += this._text.slice(offset, offset + diff[1])
            offset += diff[1]
            break
          case -1:
            offset += diff[1]
            break
          case 1:
            newText += diff[1]
            break
          default:
            throw "unknown diff: " + diff[0]
        }
      }
      this._text = newText
    },

    _onInput: function(snapshot) {
      this._applyDiffs(snapshot.val())
      this._delegate.text(this._text)
      this._inputRef.child(snapshot.key()).remove()
    },

    _updateText: function(newText) {
      var diffs = this._dmp.diff_main(this._text, newText).map(function(d) {
        if (d[0] != 1) {
          d[1] = d[1].length
        }
        return d
      })
      if (diffs.length == 1 && diffs[0][0] == 0) {
        return null
      }
      this._text = newText
      return diffs
    },

    _enqueue: function(diff) {
      this._queue.push(diff)
      this._processQueue()
    },

    _processQueue: function() {
      if (this._queueBusy || !this._running) {
        return
      }
      var diff = this._queue.shift()
      if (!diff) {
        return
      }
      this._queueBusy = true
      var _this = this
      this._outputRef.push().set(diff, function() {
        _this._queueBusy = false
        _this._processQueue()
      })
    }
  }

  Utalk.prototype.host = function() {
    if (this._running) {
      throw "Already started"
    }
    this._roomRef = this._roomsRef.push()
    this._roomRef.onDisconnect().remove()
    var hostRef = this._roomRef.child('host')
    hostRef.set(Firebase.ServerValue.TIMESTAMP)
    hostRef.onDisconnect().remove()
    this._roomRef.child('guest').on('value', this._onThem, this)
    this._amHost = true
    this._inputRef = this._roomRef.child('guest-log')
    this._outputRef = this._roomRef.child('host-log')
    this._delegate.room(this._roomRef.key())
  }

  Utalk.prototype.enter = function(roomID) {
    if (this._running) {
      throw "Already started"
    }
    this._roomRef = this._roomsRef.child(roomID)
    this._roomRef.child('host').once('value', function(snapshot) {
        if (snapshot.val() !== null) {
          var guestRef = this._roomRef.child('guest')
          guestRef.set(Firebase.ServerValue.TIMESTAMP)
          guestRef.onDisconnect().remove()
          this._roomRef.child('host').on('value', this._onThem, this)
          this._inputRef = this._roomRef.child('host-log')
          this._outputRef = this._roomRef.child('guest-log')
          this._start()
        } else {
          this._delegate.finish()
        }
    }, this)
  }

  Utalk.prototype.transmit = function(newText) {
    if (!this._running) {
      throw "Not started yet"
    }
    var diff = this._updateText(newText)
    if (diff) {
      this._enqueue(diff)
    }
  }
})(Firebase)
