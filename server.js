'use strict';

require('dotenv').config();
const path = require('path');
const { createApp } = require('./app');
const { createDb, tursoUrl } = require('./database');
const { makePortfoliosBackup, restorePortfoliosIfEmpty } = require('./lib/portfolios-backup');

const PORT = 2085;
const isProduction = process.env.NODE_ENV === 'production';

// ── Auth secret: fail closed in production ───────────────────────────────────
// SESSION_SECRET signs the JWT auth tokens. A stable secret is required so
// tokens survive restarts/deploys. In production we refuse to boot without one
// rather than minting a throwaway secret (which would invalidate every token).
let SESSION_SECRET = process.env.SESSION_SECRET;
if (!SESSION_SECRET) {
  if (isProduction) {
    console.error('FATAL: SESSION_SECRET is not set. Refusing to start in production.');
    process.exit(1);
  }
  SESSION_SECRET = require('crypto').randomBytes(32).toString('hex');
  console.warn('WARNING: SESSION_SECRET not set — using an ephemeral dev secret. Auth tokens reset on every restart. Set SESSION_SECRET in .env.');
}

async function main() {
  // Local dev uses a file: libSQL DB; set TURSO_DATABASE_URL/TURSO_AUTH_TOKEN to use Turso.
  const db = await createDb();

  const PORTFOLIOS_BACKUP = path.join(__dirname, 'portfolios.json');
  const backupPortfolios = makePortfoliosBackup(db, PORTFOLIOS_BACKUP);
  await restorePortfoliosIfEmpty(db, PORTFOLIOS_BACKUP);

  console.log('Database ready', tursoUrl() ? '(Turso)' : '(local file)');

  const app = createApp(db, {
    sessionSecret: SESSION_SECRET,
    // Secure cookies require HTTPS termination at a trusted proxy.
    secureCookies: isProduction && process.env.TRUST_PROXY === '1',
    trustProxy: process.env.TRUST_PROXY === '1',
    backupPortfolios,
    serveClient: isProduction ? 'production' : 'development',
    verbose: process.env.DEBUG_IMPORT === '1',
    cronSecret: process.env.CRON_SECRET,
  });

  await backupPortfolios(); // ensure portfolios.json is in sync on startup

  app.listen(PORT, () => {
    console.log(`Yieldly server running at http://localhost:${PORT}`);
  });
}

main().catch((e) => {
  console.error('Failed to start server:', e);
  process.exit(1);
});
