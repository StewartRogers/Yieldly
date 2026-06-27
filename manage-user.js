#!/usr/bin/env node
'use strict';

require('dotenv').config();
const readline = require('readline');
const bcrypt = require('bcryptjs');
const { createDb } = require('./database');

const { createFirstUser } = require('./lib/auth');

const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
const ask = (q) => new Promise(resolve => rl.question(q, resolve));

async function main() {
  const action = process.argv[2];
  const db = await createDb();

  if (action === 'create') {
    // Courtesy pre-check so we don't prompt for credentials we can't use; the
    // authoritative atomic guard lives in createFirstUser.
    const existing = await db.get('SELECT COUNT(*) as count FROM users');
    if (Number(existing.count) > 0) {
      console.log('A user already exists. Use "reset-password" to change the password.');
      process.exit(1);
    }
    const username = await ask('Username: ');
    const password = await ask('Password (min 8 chars): ');
    const created = await createFirstUser(db, username, password);
    if (created.error) {
      console.error(created.error);
      process.exit(1);
    }
    console.log(`User "${created.username}" created.`);

  } else if (action === 'reset-password') {
    const user = await db.get('SELECT id, username FROM users LIMIT 1');
    if (!user) {
      console.log('No user exists. Use "create" to set one up.');
      process.exit(1);
    }
    console.log(`Resetting password for user: ${user.username}`);
    const password = await ask('New password (min 8 chars): ');
    if (!password || password.length < 8) {
      console.error('Password must be at least 8 characters.');
      process.exit(1);
    }
    const hash = await bcrypt.hash(password, 10);
    await db.run('UPDATE users SET password_hash = ? WHERE id = ?', hash, user.id);
    // Stateless JWT auth: there is no server-side session list to clear here.
    // Outstanding tokens on other devices expire naturally.
    console.log('Password updated.');

  } else {
    console.log('Yieldly user management');
    console.log('');
    console.log('Usage:');
    console.log('  node manage-user.js create           Create the superuser account');
    console.log('  node manage-user.js reset-password    Reset the superuser password');
  }

  rl.close();
}

main().catch(e => { console.error(e); process.exit(1); });
