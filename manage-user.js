#!/usr/bin/env node

const readline = require('readline');
const bcrypt = require('bcryptjs');
const db = require('./database');

const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
const ask = (q) => new Promise(resolve => rl.question(q, resolve));

async function main() {
  const action = process.argv[2];

  if (action === 'create') {
    const existing = db.prepare('SELECT COUNT(*) as count FROM users').get();
    if (existing.count > 0) {
      console.log('A user already exists. Use "reset-password" to change the password.');
      process.exit(1);
    }
    const username = await ask('Username: ');
    if (!username || username.trim().length < 2) {
      console.error('Username must be at least 2 characters.');
      process.exit(1);
    }
    const password = await ask('Password (min 8 chars): ');
    if (!password || password.length < 8) {
      console.error('Password must be at least 8 characters.');
      process.exit(1);
    }
    const hash = await bcrypt.hash(password, 10);
    db.prepare('INSERT INTO users (username, password_hash) VALUES (?, ?)').run(username.trim(), hash);
    console.log(`User "${username.trim()}" created.`);

  } else if (action === 'reset-password') {
    const user = db.prepare('SELECT id, username FROM users LIMIT 1').get();
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
    db.prepare('UPDATE users SET password_hash = ? WHERE id = ?').run(hash, user.id);
    db.prepare('DELETE FROM sessions').run();
    console.log('Password updated. All sessions have been invalidated.');

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
