const session = require('express-session');
const Store = session.Store;

const CLEANUP_INTERVAL = 15 * 60 * 1000;

class SQLiteSessionStore extends Store {
  constructor(db) {
    super();
    this.db = db;
    this._getStmt = db.prepare('SELECT sess FROM sessions WHERE sid = ? AND expired > ?');
    this._setStmt = db.prepare('INSERT OR REPLACE INTO sessions (sid, sess, expired) VALUES (?, ?, ?)');
    this._destroyStmt = db.prepare('DELETE FROM sessions WHERE sid = ?');
    this._cleanupStmt = db.prepare('DELETE FROM sessions WHERE expired < ?');
    this._touchStmt = db.prepare('UPDATE sessions SET expired = ? WHERE sid = ?');

    this._cleanupStmt.run(Date.now());

    this._cleanupTimer = setInterval(() => {
      this._cleanupStmt.run(Date.now());
    }, CLEANUP_INTERVAL);
    if (this._cleanupTimer.unref) this._cleanupTimer.unref();
  }

  get(sid, callback) {
    try {
      const row = this._getStmt.get(sid, Date.now());
      callback(null, row ? JSON.parse(row.sess) : null);
    } catch (e) { callback(e); }
  }

  set(sid, sess, callback) {
    try {
      const maxAge = sess.cookie?.maxAge || 86400000;
      const expired = Date.now() + maxAge;
      this._setStmt.run(sid, JSON.stringify(sess), expired);
      callback?.(null);
    } catch (e) { callback?.(e); }
  }

  destroy(sid, callback) {
    try {
      this._destroyStmt.run(sid);
      callback?.(null);
    } catch (e) { callback?.(e); }
  }

  touch(sid, sess, callback) {
    try {
      const maxAge = sess.cookie?.maxAge || 86400000;
      const expired = Date.now() + maxAge;
      this._touchStmt.run(expired, sid);
      callback?.(null);
    } catch (e) { callback?.(e); }
  }
}

module.exports = SQLiteSessionStore;
