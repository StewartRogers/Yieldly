'use strict';

const jwt = require('jsonwebtoken');

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

function signToken(secret, payload) {
  return jwt.sign(payload, secret, { expiresIn: EXPIRES_IN });
}

function verifyToken(secret, token) {
  if (!token) return null;
  try {
    return jwt.verify(token, secret);
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

module.exports = { TOKEN_COOKIE, MAX_AGE_MS, signToken, verifyToken, setAuthCookie, clearAuthCookie };
