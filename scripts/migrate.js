#!/usr/bin/env node
'use strict';

/**
 * Apply the schema to the configured database.
 *
 *   - Local:  no env  → file:yieldly.db
 *   - Turso:  set TURSO_DATABASE_URL + TURSO_AUTH_TOKEN
 *
 * Migrations are idempotent (CREATE TABLE IF NOT EXISTS), so this is safe to
 * run repeatedly. Run once after provisioning a new Turso database.
 */

require('dotenv').config();
const { createDb } = require('../database');

(async () => {
  const target = process.env.TURSO_DATABASE_URL || 'local file (yieldly.db)';
  const db = await createDb(); // createDb runs migrations
  await db.close();
  console.log(`Schema applied to ${target}.`);
  process.exit(0);
})().catch((e) => {
  console.error('Migration failed:', e.message);
  process.exit(1);
});
