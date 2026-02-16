# Yieldly

A local portfolio tracking web application for managing stock investments, dividends, and transaction history.

## Features

- 📊 **Multiple Portfolios** - Create and manage multiple portfolios with unique names and codes
- 💰 **Transaction Tracking** - Record buys, sells, dividends, and dividend reinvestments
- 📈 **Portfolio Overview** - View holdings, average cost, and dividend totals for each portfolio
- 📥 **CSV Import** - Bulk import historical transactions from CSV files
- 🔍 **Transaction History** - Paginated view of all transactions with delete functionality
- 💾 **Persistent Storage** - SQLite database that survives server restarts

## Tech Stack

- **Backend**: Node.js + Express
- **Database**: SQLite (better-sqlite3)
- **Frontend**: Vanilla HTML, CSS, JavaScript (no build tools required)

## Installation

### Prerequisites

- Node.js (v14 or higher)

### Setup

1. Clone the repository:
```bash
git clone https://github.com/yourusername/yieldly.git
cd yieldly
```

2. Install dependencies:
```bash
npm install
```

3. Start the server:
```bash
npm start
```

4. Open your browser to `http://localhost:3000`

## Usage

### Creating a Portfolio

1. Navigate to the **Portfolios** page
2. Click **+ New Portfolio**
3. Enter a name (e.g., "Retirement Fund") and code (e.g., "RR")
4. Click **Create Portfolio**

### Adding Transactions

1. Navigate to the **Transactions** page
2. Select a portfolio from the dropdown
3. Fill in transaction details:
   - **Buy/Sell/Dividend Reinvestment**: Ticker, quantity, price per share, date
   - **Dividend**: Ticker, total amount, date
4. Click **Add Transaction**

### Importing CSV Data

1. Navigate to the **Import Data** page
2. Click **Choose CSV File** and select your file
3. Click **Import CSV**

**CSV Format:**
```
Date,Symbol,Portfolio,Type,Quantity,Share Price,Total
01-Jan-24,AAPL,RR,B,10,150.00,1500.00
15-Feb-24,AAPL,RR,D,0,0,25.50
```

**Transaction Types:**
- `B` - Buy
- `S` - Sell
- `D` - Dividend
- `DR` - Dividend Reinvestment

**Date Format:** DD-MMM-YY (e.g., 01-Jan-24, 15-Feb-24)

## Project Structure

```
yieldly/
├── database.js          # SQLite database setup and schema
├── server.js            # Express server and API endpoints
├── package.json         # Project dependencies
├── public/
│   ├── index.html       # Main application UI
│   ├── style.css        # Styling
│   ├── app.js           # Client-side JavaScript
│   └── logo.svg         # Application logo
└── yieldly.db          # SQLite database (auto-generated)
```

## API Endpoints

### Portfolios
- `GET /api/portfolios` - Get all portfolios
- `POST /api/portfolios` - Create a new portfolio
- `DELETE /api/portfolios/:id` - Delete a portfolio
- `GET /api/portfolios/:id/summary` - Get portfolio holdings summary
- `GET /api/portfolios/:id/transactions` - Get all transactions for a portfolio

### Transactions
- `POST /api/transactions` - Add a new transaction
- `DELETE /api/transactions/:id` - Delete a transaction

### Import
- `POST /api/import/csv` - Import transactions from CSV

## License

MIT
