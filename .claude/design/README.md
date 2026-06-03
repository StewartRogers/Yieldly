# Handoff: Yieldly — Portfolio Tracker UI Refresh

## Overview
Yieldly is a portfolio-tracking web app for managing stock investments, dividends, and
transactions across multiple registered/non-registered accounts (RRSP, TFSA, RE, RF).
This package contains wireframes for all six pages of the app: **Home, Summary,
Dividends, Portfolios, Transactions, and Import Data**. The goal of this work is a UI
refresh — the existing feature set stays the same; the layouts here are the proposed
new structure.

## About the Design Files
The file in this bundle (`Wireframes.html`) is a **design reference created in HTML** — a
single-file prototype that shows the intended layout, information hierarchy, and a few
live interactions (page tabs, the Portfolios Card/List toggle, and a Tweaks panel). It is
**not production code to copy directly**.

The task is to **recreate these layouts in Yieldly's existing codebase** — a **React**
frontend with a **Node/Express + SQLite** backend — using its established components,
routing, state, and styling conventions. Wire the layouts to the real API/data already in
the app. Do not port the sketch/hand-drawn aesthetic; that is a wireframe convention only
(see Fidelity below).

## Fidelity
**Low-fidelity (lofi).** These are wireframes. They communicate:
- Page structure, grid/column layout, and component placement
- Information hierarchy and grouping
- Table columns, form fields, and content/copy
- Interaction patterns (tabs, toggles, modals, pagination)

They intentionally do **not** specify final colors, fonts, or spacing — the hand-drawn
look (Kalam/Caveat fonts, paper background, wobbly borders) is wireframe styling to be
**discarded**. Apply Yieldly's existing design system / component library for all visual
styling. Where the app has no established pattern for something, choose a clean, neutral
treatment consistent with the rest of the app.

---

## Global Layout

### Top Navigation Bar (sticky header)
- Left: logo mark + "Yieldly" wordmark.
- Nav links in order: **Home · Summary · Dividends · Portfolios · Transactions · Import Data**.
- Active route is highlighted (filled/inverted treatment in the wireframe — use the app's
  active-nav style).
- Right: user avatar / account menu.
- Below the header, all pages use a **centered, max-width page container** (the wireframe
  uses ~1400px; match the app's existing container width).

### Cross-cutting conventions
- **Numbers**: right-aligned, tabular/fixed-width figures so columns align to the cent.
  Currency formatted for **Canadian locale** (e.g. `$1,234.56`).
- **Positive vs negative**: gains and losses are shown in two different colors in the real
  app. The wireframe uses ▲/▼ arrows (B&W) with an optional green/red toggle — use the
  app's existing positive/negative colors.
- **Responsive**: layout should reflow for mobile (stack columns, allow tables to scroll
  horizontally).

---

## Screens / Views

### 1. Home — route `/`
- **Purpose**: Landing/marketing-lite page; quick jump-off into the app + teaser for the
  upcoming AI assistant.
- **Layout**: Single centered column, two stacked sections.
  - **Hero** (top, bordered section): small eyebrow pill ("Your money, all in one
    ledger"), large headline ("Track every share, dividend & dollar."), one-line
    subhead, then a row of 3 buttons: **View Summary** (primary), **Open Portfolios**,
    **Import Data**.
  - **AI Portfolio Assistant** (below): heading + a **"Coming soon"** pill. A chat-preview
    card showing 2–3 example message bubbles (user prompts + one assistant reply) with a
    **disabled** input row and "Preview only — assistant is not live yet" caption. Below
    it, a row of 3 small feature hints (suggested prompts / reads live holdings / stays on
    device).
- **Behavior**: The assistant is non-functional (disabled input). Hero buttons route to
  the named pages.

### 2. Summary — route `/summary`
- **Purpose**: All-accounts financial overview + book-value history.
- **Layout**: Header row (title + "prices updated …" timestamp + **Refresh All Prices**
  button), then two stacked tables.
- **Table A — Portfolio Overview**:
  - Columns: **Portfolio | Cash Balance | Buy Total | Sale Total | Cash Invested | Market Value**.
  - One row per portfolio (RRSP, TFSA, RE, RF) + a bold **Grand total** row.
  - **Cash Balance is inline-editable** per portfolio (pencil affordance; click cell → edit
    in place → save).
  - Note for implementer: `Cash Invested = Buy Total − Sale Total`.
- **Table B — Book Value of Holdings (end-of-month ACB)**:
  - Matrix: **rows = months (Jan…Dec)**, **columns = years** (last ~5, e.g. 2022–2026).
  - Cells = end-of-month Adjusted Cost Base across all portfolios. Empty future months show
    "—". Bottom **Dec close** total row.
  - Controls: By month / By quarter toggle, year selector.
- **Behavior**: **Refresh All Prices** triggers the live price fetch (existing endpoint) and
  updates Market Value cells with a loading state.

### 3. Dividends — route `/dividends`
- **Purpose**: Monthly dividend income by year, per account.
- **Layout**: Header, then an account switcher (pills: **All · RRSP · TFSA · RE · RF**),
  then an optional 4-up KPI strip (This year/TTM, Avg/month, Best month, New streams), then
  the income matrix.
- **Income matrix**:
  - **Rows = months (Jan…Dec)**, **columns = last 5 years**, plus a trailing **YoY** column.
  - Cells = dividend income for that month/year. Bottom **Annual total** row.
  - **YoY** column shows % change vs the same month prior year (up/down colored).
  - A **"New"** tag marks the first payment from a newly-held position.
- **Behavior**: Switching the account pill re-scopes the whole matrix to that portfolio
  (or All).

### 4. Portfolios — route `/portfolios` (the primary workspace)
- **Purpose**: Browse and manage holdings within each account.
- **Layout / controls (top to bottom)**:
  1. **Draggable account tabs** (RRSP, TFSA, RE, RF) — reorderable via drag handle, **order
     persisted** to the backend. Active tab highlighted.
  2. **Create portfolio** inline form: Name field + Code field + **Create** button.
  3. **View toggle**: **Card** ⇄ **List** (this is live in the prototype — see Interactions).
  4. Context row: "<ACCOUNT> · N holdings · $total" + per-portfolio **Refresh Prices** button.
- **Card view**: responsive grid of per-holding cards. Each card shows:
  - Ticker (large) + company name + **investment type badge** (Stock / ETF / Other).
  - Key-value pairs: Shares, Buy price, Market price, Buy total, Market total, Sale total,
    Dividends paid, Yield, Dividend frequency + per-share amount, Annual payout.
  - **Return** footer line: `$` and `%`, colored positive/negative.
  - Two actions: **Edit** and **Txns**.
  - A trailing dashed "Add holding" card.
- **List view**: same dataset as a dense table — columns: Ticker, Type, Shares, Buy, Mkt,
  Buy Total, Mkt Total, Div Paid, Yield, Return, actions (Edit / Txns). Totals row.
- **Modals** (sketched at the bottom of the Portfolios section in the prototype):
  - **Stock Info Editor** — fields: Market price, Sector, Investment type (Stock/ETF/Other),
    Dividend frequency, Dividend/share, Next pay date. Cancel / Save.
  - **Holding Transactions** — wide dialog. Top **summary bar**: Net shares, Total cost,
    Commission, ACB/share. Below: scrollable table of that ticker's transactions
    (Date, Type, Shares, Price, Total).
- **Behavior**: Card/List toggle swaps the view without reload. Drag-reorder persists tab
  order. Edit/Txns open the respective modal for that holding. Refresh Prices updates market
  prices + dependent totals.

### 5. Transactions — route `/transactions`
- **Purpose**: Record transactions and review history.
- **Layout**: Two columns — **Add form** (left, ~320px, shaded panel) and **History**
  (right, fills remaining width).
- **Add Transaction form** fields:
  - Portfolio (select), Type (select: **Buy, Sell, Dividend, Dividend Reinvest,
    Contribution, Withdrawal**), Quantity, Price/share, **Total (auto-calculated, read-only,
    visibly derived)**, Commission, Date. **Add transaction** button.
- **Transaction History table**:
  - Columns: Ticker, **Type (color-coded badge)**, Shares, Price, Total, Date, **delete**.
  - **Paginated at 20 rows** (prev / numbered / next). Record count shown.
  - Type badges are color-coded in the real app; the wireframe distinguishes the six types
    by border/fill pattern — map each to the app's color system.
- **Behavior**: Total auto-updates from Quantity × Price as the user types. Add appends to
  history. Delete removes a row (confirm as appropriate). Optional filters by type/account.

### 6. Import Data — route `/import`
- **Purpose**: Bulk-import transactions from CSV.
- **Layout**: Two columns.
  - **Left — Upload**: drag-and-drop **dropzone** (click to browse, .csv), selected-file
    name + **Import** button (with loading state), then a **status panel**: success summary
    (rows added / skipped / errors) with an expandable **error detail** list (row-addressed,
    with suggested fixes).
  - **Right — Expected format**: a documented column spec table (Column / Example / Notes)
    covering: portfolio, ticker, type, quantity, price, commission, date (YYYY-MM-DD) — plus
    a copy-pasteable sample header+row and a **Download template** button.
- **Behavior**: Import shows loading, then success/error status. Errors list offending rows
  and the reason.

---

## Interactions & Behavior (summary)
- **Top nav**: client-side routing between the six pages; active link highlighted.
- **Summary**: inline-edit cash balance; Refresh All Prices (async fetch + loading).
- **Dividends**: account pill switch re-scopes the matrix.
- **Portfolios**: drag-reorder tabs (persisted); Card/List toggle; Edit + Txns modals;
  per-portfolio Refresh Prices.
- **Transactions**: live total calc; add/delete rows; 20-row pagination.
- **Import**: file drop → Import (loading) → success/error status with error detail viewer.
- **Modals**: open over the page with a backdrop; Esc / Cancel / ✕ to close.

## State Management
- **Active route/page** (router).
- **Selected portfolio/account** on Portfolios and Dividends.
- **Portfolio tab order** (persisted — backend or local, match existing app).
- **Card vs List** view preference on Portfolios.
- **Add-transaction form** fields + derived total.
- **History pagination** (page index, page size = 20).
- **Modal open/target** (which holding's Edit/Txns is open).
- **Async/loading states** for price refresh and CSV import; **error state** for import.
- Data fetching: holdings, transactions, dividends, prices, and book-value/ACB history come
  from the existing Express/SQLite API — wire to those endpoints.

## Design Tokens
**None are prescribed** — this is lofi. Use Yieldly's existing tokens for color, spacing,
type, radius, and shadow. The only semantic tokens that matter:
- **Positive / negative** (gain/loss) color pair — reuse the app's.
- **Transaction-type** color set for the six badge types (Buy, Sell, Dividend, Dividend
  Reinvest, Contribution, Withdrawal).
- Tabular/monospaced numeric alignment for money columns.

## Assets
No real images or icons are used — the prototype uses dashed placeholders (`img`, avatar,
logo mark) and unicode glyphs. Supply real icons from the app's existing icon set. No
licensed/brand assets are included.

## Screenshots
Full-page renders of each wireframe live in `screenshots/` (one per page, in nav order):
- `01-home.png` · `02-summary.png` · `03-dividends.png` · `04-portfolios.png`
  (includes both modals) · `05-transactions.png` · `06-import.png`

These are for eyeballing layout only — the hand-drawn styling is a wireframe convention and
should not be reproduced.

## Files
- `Wireframes.html` — the full six-page wireframe (single file). Open in a browser. Use the
  top tabs to move between pages; on **Portfolios**, try the **Card/List** toggle. The
  floating **Tweaks** panel and hand-drawn styling are prototype-only and should be ignored
  for implementation.
- An earlier 3-screen exploration (superseded) lives in the project's `archive/` folder and
  is not needed for this handoff.
