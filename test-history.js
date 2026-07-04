'use strict';

/**
 * Yieldly History-Matrix Test Suite
 *
 * Covers the pure aggregation math behind the History page's value matrix
 * (client/src/utils/historyMatrix.js): pivot building, cross-portfolio
 * summing, month-over-month %, year totals (including the current-year YTD
 * walk-back), and year-over-year %. No DB, no server — plain function calls.
 *
 * historyMatrix.js is an ES module (client/ is "type": "module"), so it's
 * loaded here via dynamic import() from this CommonJS script.
 *
 * Usage:  node test-history.js
 */

let passed = 0, failed = 0;

function check(label, actual, expected, tolerance = 0.005) {
  const ok = Math.abs(actual - expected) <= tolerance;
  if (ok) {
    console.log(`  ✓  ${label}`);
    passed++;
  } else {
    console.error(`  ✗  ${label}`);
    console.error(`       expected ${expected}, got ${actual}`);
    failed++;
  }
}

function checkEq(label, actual, expected) {
  const ok = actual === expected;
  if (ok) {
    console.log(`  ✓  ${label}`);
    passed++;
  } else {
    console.error(`  ✗  ${label}`);
    console.error(`       expected ${JSON.stringify(expected)}, got ${JSON.stringify(actual)}`);
    failed++;
  }
}

function section(title) { const pad = Math.max(2, 50 - title.length); console.log(`\n── ${title} ${'─'.repeat(pad)}`); }

async function main() {
  const { buildPivot, sumPivots, pivotValue, momChange, yearTotal, yoyChange } =
    await import('./client/src/utils/historyMatrix.js');

  // ─── buildPivot ─────────────────────────────────────────────────────────
  section('1. buildPivot — keeps the latest snapshot per year-month');
  {
    const pivot = buildPivot([
      { date: '2025-03-10', total_value: 100, source: 'cron' },
      { date: '2025-03-31', total_value: 110, source: 'cron' },
      { date: '2025-03-15', total_value: 999, source: 'manual' }, // earlier date, must lose
    ]);
    check('keeps latest-dated value for the month', pivot[2025][3].value, 110);
    checkEq('keeps the date of the winning row', pivot[2025][3].date, '2025-03-31');
    checkEq('keeps the source of the winning row', pivot[2025][3].source, 'cron');
  }

  section('2. buildPivot — separates years and months');
  {
    const pivot = buildPivot([
      { date: '2024-12-31', total_value: 500, source: 'cron' },
      { date: '2025-01-31', total_value: 520, source: 'cron' },
    ]);
    check('2024-12 recorded', pivot[2024][12].value, 500);
    check('2025-01 recorded', pivot[2025][1].value, 520);
    checkEq('no cross-contamination into 2025-12', pivot[2025][12], undefined);
  }

  section('3. buildPivot — empty input');
  {
    checkEq('empty rows → empty pivot', JSON.stringify(buildPivot([])), '{}');
  }

  // ─── sumPivots ──────────────────────────────────────────────────────────
  section('4. sumPivots — cell-wise sum across portfolios');
  {
    const a = buildPivot([{ date: '2025-06-30', total_value: 100, source: 'cron' }]);
    const b = buildPivot([{ date: '2025-06-30', total_value: 250, source: 'cron' }]);
    const summed = sumPivots([a, b]);
    check('sums both portfolios for the same month', summed[2025][6].value, 350);
  }

  section('5. sumPivots — a portfolio missing data contributes 0, not null');
  {
    const a = buildPivot([{ date: '2025-06-30', total_value: 100, source: 'cron' }]);
    const b = buildPivot([{ date: '2025-07-31', total_value: 999, source: 'cron' }]); // no June row
    const summed = sumPivots([a, b]);
    check('June total is just portfolio a\'s value', summed[2025][6].value, 100);
    check('July total is just portfolio b\'s value', summed[2025][7].value, 999);
  }

  section('6. sumPivots — empty pivot list');
  {
    checkEq('no pivots → empty result', JSON.stringify(sumPivots([])), '{}');
  }

  // ─── pivotValue ─────────────────────────────────────────────────────────
  section('7. pivotValue — null-safe lookups');
  {
    const pivot = buildPivot([{ date: '2025-05-31', total_value: 42, source: 'cron' }]);
    check('existing cell', pivotValue(pivot, 2025, 5), 42);
    checkEq('missing month → null', pivotValue(pivot, 2025, 6), null);
    checkEq('missing year → null', pivotValue(pivot, 2020, 5), null);
    checkEq('undefined pivot → null (optional chaining)', pivotValue(undefined, 2025, 5), null);
  }

  // ─── momChange ──────────────────────────────────────────────────────────
  section('8. momChange — plain month-over-month');
  {
    const pivot = buildPivot([
      { date: '2025-04-30', total_value: 100, source: 'cron' },
      { date: '2025-05-31', total_value: 110, source: 'cron' },
    ]);
    check('May up 10% vs April', momChange(pivot, 2025, 5), 10);
  }

  section('9. momChange — January wraps to prior December');
  {
    const pivot = buildPivot([
      { date: '2024-12-31', total_value: 200, source: 'cron' },
      { date: '2025-01-31', total_value: 150, source: 'cron' },
    ]);
    check('Jan 2025 down 25% vs Dec 2024', momChange(pivot, 2025, 1), -25);
  }

  section('10. momChange — missing data and division by zero return null');
  {
    const pivot = buildPivot([
      { date: '2025-05-31', total_value: 0, source: 'cron' },
      { date: '2025-06-30', total_value: 50, source: 'cron' },
    ]);
    checkEq('no current-month value → null', momChange(pivot, 2025, 3), null);
    checkEq('no prior-month value → null', momChange(pivot, 2025, 1), null);
    checkEq('prior value of 0 → null (avoid Infinity)', momChange(pivot, 2025, 6), null);
  }

  // ─── yearTotal ──────────────────────────────────────────────────────────
  section('11. yearTotal — closed year uses December value');
  {
    const pivot = buildPivot([
      { date: '2024-06-30', total_value: 999, source: 'cron' },
      { date: '2024-12-31', total_value: 500, source: 'cron' },
    ]);
    check('closed year → Dec value, not mid-year', yearTotal(pivot, 2024, 2026, 7), 500);
  }

  section('12. yearTotal — closed year with no December snapshot is null');
  {
    const pivot = buildPivot([{ date: '2024-06-30', total_value: 999, source: 'cron' }]);
    checkEq('no Dec row → null (no fallback for closed years)', yearTotal(pivot, 2024, 2026, 7), null);
  }

  section('13. yearTotal — current year uses the exact current month if present');
  {
    const pivot = buildPivot([{ date: '2026-07-15', total_value: 777, source: 'cron' }]);
    check('current month value used directly', yearTotal(pivot, 2026, 2026, 7), 777);
  }

  section('14. yearTotal — current year walks back to latest known month (YTD)');
  {
    const pivot = buildPivot([{ date: '2026-05-31', total_value: 640, source: 'cron' }]);
    // Cron hasn't posted June or July yet — should fall back to May, not null.
    check('walks back past empty June/July to May', yearTotal(pivot, 2026, 2026, 7), 640);
  }

  section('15. yearTotal — current year with zero data at all is null');
  {
    const pivot = {};
    checkEq('nothing recorded yet this year → null', yearTotal(pivot, 2026, 2026, 7), null);
  }

  // ─── yoyChange ──────────────────────────────────────────────────────────
  section('16. yoyChange — closed year vs closed year');
  {
    const pivot = buildPivot([
      { date: '2024-12-31', total_value: 1000, source: 'cron' },
      { date: '2025-12-31', total_value: 1200, source: 'cron' },
    ]);
    check('2025 up 20% vs 2024', yoyChange(pivot, 2025, 2026, 7), 20);
  }

  section('17. yoyChange — current year (YTD) vs prior year-end');
  {
    const pivot = buildPivot([
      { date: '2025-12-31', total_value: 800, source: 'cron' },
      { date: '2026-04-30', total_value: 900, source: 'cron' }, // latest so far this year
    ]);
    check('2026 YTD up 12.5% vs 2025 year-end', yoyChange(pivot, 2026, 2026, 7), 12.5);
  }

  section('18. yoyChange — missing prior year or zero baseline → null');
  {
    const noPriorYear = buildPivot([{ date: '2025-12-31', total_value: 500, source: 'cron' }]);
    checkEq('no data at all for the earlier year → null', yoyChange(noPriorYear, 2025, 2026, 7), null);

    const zeroBase = buildPivot([
      { date: '2024-12-31', total_value: 0, source: 'cron' },
      { date: '2025-12-31', total_value: 500, source: 'cron' },
    ]);
    checkEq('prior year total of 0 → null (avoid Infinity)', yoyChange(zeroBase, 2025, 2026, 7), null);
  }

  section('19. yoyChange — netFlow subtracts contributed cash to isolate organic growth');
  {
    // The worked example from the feature request: 100 -> 110 with $10
    // contributed during the year is 0% real growth, not +10%.
    const pivot = buildPivot([
      { date: '2024-12-31', total_value: 100, source: 'cron' },
      { date: '2025-12-31', total_value: 110, source: 'cron' },
    ]);
    check('no netFlow (default) → +10%', yoyChange(pivot, 2025, 2026, 7), 10);
    check('$10 net contribution → 0% organic growth', yoyChange(pivot, 2025, 2026, 7, 10), 0);
    check('a net withdrawal makes organic growth look better', yoyChange(pivot, 2025, 2026, 7, -10), 20);
  }

  section('20. yoyChange — netFlow on a partial current year (YTD)');
  {
    const pivot = buildPivot([
      { date: '2025-12-31', total_value: 800, source: 'cron' },
      { date: '2026-04-30', total_value: 900, source: 'cron' }, // latest so far this year
    ]);
    // $50 contributed so far this year (through the current month) should be
    // subtracted from the YTD gain the same way a full year's flow would be.
    check('2026 YTD with $50 contributed so far → 6.25%', yoyChange(pivot, 2026, 2026, 7, 50), 6.25);
  }

  // ─── Summary ────────────────────────────────────────────────────────────
  const total = passed + failed;
  console.log(`\n${'═'.repeat(58)}`);
  console.log(`  ${total} tests   ${passed} passed   ${failed} failed`);
  console.log(`${'═'.repeat(58)}\n`);
  process.exit(failed > 0 ? 1 : 0);
}

main();
