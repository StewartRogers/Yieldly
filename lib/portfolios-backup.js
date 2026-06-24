'use strict';

const fs = require('fs');

/**
 * Local-disk backup of the portfolios table.
 *
 * NOTE: This is a single-host convenience for the self-hosted / local-file
 * deployment. It persists portfolio names/codes/order only (not the
 * transaction ledger) and relies on a writable local filesystem. On Vercel the
 * filesystem is ephemeral, so this is a no-op there (no backup path is wired
 * up) — Turso's own backups/restore are the source of truth in the cloud.
 */

/** Returns an async `backup()` that snapshots portfolios to `backupPath`. */
function makePortfoliosBackup(db, backupPath) {
  return async function backup() {
    try {
      const rows = await db.all('SELECT name, code, display_order FROM portfolios ORDER BY display_order, id');
      fs.writeFileSync(backupPath, JSON.stringify(rows, null, 2));
    } catch (e) {
      console.error('Failed to backup portfolios:', e.message);
    }
  };
}

/** Restore portfolios from `backupPath` only if the portfolios table is empty. */
async function restorePortfoliosIfEmpty(db, backupPath) {
  const row = await db.get('SELECT COUNT(*) as count FROM portfolios');
  if (Number(row.count) > 0 || !fs.existsSync(backupPath)) return;
  try {
    const saved = JSON.parse(fs.readFileSync(backupPath, 'utf8'));
    const tx = await db.transaction('write');
    try {
      for (const p of saved) {
        await tx.execute({
          sql: 'INSERT INTO portfolios (name, code, display_order) VALUES (?, ?, ?)',
          args: [p.name, p.code, p.display_order || 0],
        });
      }
      await tx.commit();
    } catch (e) {
      await tx.rollback();
      throw e;
    }
    console.log(`Restored ${saved.length} portfolios from ${backupPath}`);
  } catch (e) {
    console.error('Failed to restore portfolios from backup:', e.message);
  }
}

module.exports = { makePortfoliosBackup, restorePortfoliosIfEmpty };
