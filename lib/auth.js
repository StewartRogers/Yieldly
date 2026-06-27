'use strict';

const jwt = require('jsonwebtoken');
const bcrypt = require('bcryptjs');

/**
 * Stateless JWT authentication.
 *
 * The token is a signed JWT carrying { userId, username }, stored in an
 * httpOnly cookie. There is no server-side session table — verification is a
 * signature check, so it costs no database round-trip per request (important
 * on serverless / Turso, where a DB read per request is a network hop).
 *
 * Trade-off of statelessness: logout clears the cookie on this client, and
 * tokens expire after MAX_AGE. There is no server-side revocation list, so for
 * this single-user app a password change does not retroactively invalidate
 * tokens already issued to other devices — they simply expire.
 */

const TOKEN_COOKIE = 'token';
const MAX_AGE_MS = 7 * 24 * 60 * 60 * 1000; // 7 days
const EXPIRES_IN = '7d';
// Pin the signing/verification algorithm so verification can never be coerced
// into accepting a different one (e.g. `alg: none` or an RS256→HS256 key
// confusion) regardless of library defaults.
const ALGORITHM = 'HS256';

function signToken(secret, payload) {
  return jwt.sign(payload, secret, { expiresIn: EXPIRES_IN, algorithm: ALGORITHM });
}

function verifyToken(secret, token) {
  if (!token) return null;
  try {
    return jwt.verify(token, secret, { algorithms: [ALGORITHM] });
  } catch {
    return null;
  }
}

function setAuthCookie(res, token, secure) {
  res.cookie(TOKEN_COOKIE, token, {
    httpOnly: true,
    secure,
    sameSite: 'lax',
    maxAge: MAX_AGE_MS,
  });
}

function clearAuthCookie(res) {
  res.clearCookie(TOKEN_COOKIE);
}

const BCRYPT_ROUNDS = 10;
const MIN_USERNAME_LEN = 2;
const MIN_PASSWORD_LEN = 8;

/**
 * Validate input and atomically create the single first user ("first user
 * wins"). Shared by the /api/auth/setup route and the manage-user CLI so the
 * bcrypt cost, length rules, and count-then-insert race guard live in one place
 * and can't drift apart.
 *
 * Returns { userId, username } on success, or { error, status } describing why
 * it was rejected (the caller maps that to an HTTP response or a CLI message).
 */
async function createFirstUser(db, username, password) {
  if (!username || typeof username !== 'string' || username.trim().length < MIN_USERNAME_LEN) {
    return { error: `Username must be at least ${MIN_USERNAME_LEN} characters`, status: 400 };
  }
  if (!password || typeof password !== 'string' || password.length < MIN_PASSWORD_LEN) {
    return { error: `Password must be at least ${MIN_PASSWORD_LEN} characters`, status: 400 };
  }
  const hash = await bcrypt.hash(password, BCRYPT_ROUNDS);
  const tx = await db.transaction('write');
  try {
    const count = Number((await tx.execute('SELECT COUNT(*) as count FROM users')).rows[0].count);
    if (count > 0) {
      await tx.rollback();
      return { error: 'Setup already completed', status: 403 };
    }
    const result = await tx.execute({
      sql: 'INSERT INTO users (username, password_hash) VALUES (?, ?)',
      args: [username.trim(), hash],
    });
    const userId = Number(result.lastInsertRowid);
    // Nothing fallible runs after commit, so the catch's rollback can only be
    // reached on a pre-commit failure — no need to track a "committed" flag.
    await tx.commit();
    return { userId, username: username.trim() };
  } catch (e) {
    await tx.rollback();
    throw e;
  }
}

module.exports = {
  TOKEN_COOKIE, MAX_AGE_MS, signToken, verifyToken, setAuthCookie, clearAuthCookie, createFirstUser,
};
