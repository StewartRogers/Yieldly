# Yieldly

Yieldly is a local stock portfolio tracker for managing multiple portfolios, transaction history, dividend income, and basic market data stored in a SQLite database.

## What It Does

- Manage multiple portfolios with unique codes and configurable display order
- Track buys, sells, dividends, dividend reinvestments, contributions, and withdrawals
- View holdings, average cost, sale totals, dividends paid, and estimated market value
- Store manual stock details such as market price, dividend yield, sector, and investment type
- Refresh stock prices and dividend data from TMX for supported tickers
- Import historical transactions from CSV
- Keep data locally in SQLite with automatic persistence across restarts

## Tech Stack

- Backend: Node.js + Express
- Database: SQLite via `better-sqlite3`
- Frontend: React + Vite app in `client/`

## Requirements

- Node.js 14 or newer
- npm

## Setup

1. Install dependencies from the repository root:
```bash
npm install
```

2. Start the app in development mode:
```bash
npm run dev
```

3. Open `http://localhost:2080`

## Production Build

1. Build the client app:
```bash
npm run build
```

2. Start the server in production mode:
```bash
npm run start:prod
```

## Environment Variables

The app loads `.env` automatically. Optional variables include:

- `NODE_ENV=production` - serves the built client from `client/dist`

## Supported Transaction Types

- `BUY`
- `SELL`
- `DIVIDEND`
- `DIVIDEND_REINVEST`
- `CONTRIBUTION`
- `WITHDRAWAL`

Cash-flow transactions use `CASH` as the ticker internally.

## CSV Import

The CSV importer expects a header row and at least these columns:

`Date,Symbol,Portfolio,Type,Quantity,Share Price,Total`

Example:

```csv
Date,Symbol,Portfolio,Type,Quantity,Share Price,Total
01-Jan-24,AAPL,RR,B,10,150.00,1500.00
15-Feb-24,AAPL,RR,D,0,0,25.50
```

Supported type codes for imports depend on the app UI and database mapping. The app currently recognizes the transaction types listed above.

## API Endpoints

### Portfolios

- `GET /api/portfolios` - List all portfolios
- `POST /api/portfolios` - Create a portfolio
- `PUT /api/portfolios/:id/order` - Update portfolio display order
- `PUT /api/portfolios/:id/cash-balance` - Set or clear a manual cash balance
- `DELETE /api/portfolios/:id` - Delete a portfolio
- `GET /api/portfolios/:id/summary` - Get aggregated holdings for one portfolio
- `GET /api/portfolios/:id/transactions` - Get all transactions for one portfolio
- `GET /api/portfolios/:id/transactions/ticker/:ticker` - Get transactions for one ticker
- `PUT /api/portfolios/:portfolioId/stocks/:ticker` - Update manual stock info
- `POST /api/portfolios/:portfolioId/refresh-prices` - Refresh TMX quote data for one portfolio

### Transactions

- `POST /api/transactions` - Add a transaction
- `DELETE /api/transactions/:id` - Delete a transaction

### Summary and Income

- `GET /api/summary` - Combined holdings across all portfolios
- `GET /api/overview` - Portfolio overview with cash and market value fields
- `GET /api/summary/monthly-acb` - Monthly average cost basis trend
- `GET /api/dividends/monthly` - Monthly dividend totals by portfolio

### Import

- `POST /api/import/csv` - Import transactions from CSV

### Refresh

- `POST /api/refresh-all-prices` - Refresh TMX quote data for every holding across all portfolios

## Project Structure

```text
yieldly/
├── client/              # React frontend used in production builds
├── public/              # Static development UI
├── lib/                 # Shared server-side helpers
├── database.js              # SQLite schema and migrations
├── server.js                # Express API server
├── yieldly.db               # Local SQLite database (git-ignored)
├── portfolios.json          # Auto-generated portfolio backup (git-ignored)
└── portfolios.example.json  # Example seed file — copy to portfolios.json to pre-seed
```

## Notes

- The database is created automatically on first run.
- Portfolio metadata is backed up to `portfolios.json` (git-ignored) on every write so it can be restored if the database is recreated. Copy `portfolios.example.json` to `portfolios.json` to pre-seed portfolios on a fresh install.
- The app is designed to run locally, not as a hosted multi-user service.

## License

MIT
