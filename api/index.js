'use strict';

/**
 * Vercel serverless entrypoint.
 *
 * Vercel routes `/api/*` to this function (see vercel.json). The Express app is
 * built once per warm instance and reused across invocations. Persistence is
 * remote Turso, configured via TURSO_DATABASE_URL / TURSO_AUTH_TOKEN (or the
 * yieldly_storage_-prefixed vars the Vercel Turso integration provisions).
 *
 * Local development does NOT use this file — it runs server.js directly against
 * a local `file:` libSQL database.
 */

const { createApp } = require('../app');
const { createDb, tursoUrl } = require('../database');

let appPromise = null;

function getApp() {
  if (!appPromise) {
    appPromise = (async () => {
      if (!process.env.SESSION_SECRET) {
        throw new Error('SESSION_SECRET is not set');
      }
      if (!tursoUrl()) {
        throw new Error('TURSO_DATABASE_URL (or yieldly_storage_TURSO_DATABASE_URL) is not set');
      }
      // Idempotent (CREATE TABLE IF NOT EXISTS); cheap to run on cold start.
      const db = await createDb();
      return createApp(db, {
        sessionSecret: process.env.SESSION_SECRET,
        secureCookies: true,
        trustProxy: true,
        serveClient: false, // static client is served by Vercel's CDN
        rateLimit: { windowMs: 15 * 60 * 1000, max: 10 },
        cronSecret: process.env.CRON_SECRET,
      });
    })().catch((err) => {
      appPromise = null; // allow a retry on the next invocation
      throw err;
    });
  }
  return appPromise;
}

module.exports = async (req, res) => {
  try {
    const app = await getApp();
    return app(req, res);
  } catch (err) {
    console.error('Function init failed:', err);
    res.statusCode = 500;
    res.setHeader('Content-Type', 'application/json');
    res.end(JSON.stringify({ error: 'Server misconfigured' }));
  }
};
