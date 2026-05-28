const fmtCurrency = v => v == null ? '—' : '$' + Number(v).toLocaleString('en-CA', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const fmtCurrencyOr = v => (v && v !== 0) ? fmtCurrency(v) : '—';

// Escape a value for safe insertion into HTML text content or attribute values.
function escapeHtml(s) {
  if (s == null) return '';
  return String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
                  .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
}

// Escape a value for use as a single-quoted string arg inside an onclick HTML attribute.
// Escapes JS metacharacters first, then HTML-encodes so the attribute stays well-formed.
function escapeAttrJs(s) {
  if (s == null) return '';
  return String(s).replace(/\\/g, '\\\\').replace(/'/g, "\\'")
                  .replace(/&/g, '&amp;').replace(/</g, '&lt;')
                  .replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

let currentPortfolioId = null;
let holdingsView = 'card';
let currentPage = 1;
const TRANSACTIONS_PER_PAGE = 20;
let allTransactions = [];
let csvFileData = null;

// Initialize the app
document.addEventListener('DOMContentLoaded', () => {
  loadPortfolios();
  setupNavigation();
  setupEventListeners();
});

// Navigation
function setupNavigation() {
  const navLinks = document.querySelectorAll('.nav-link');
  const pages = document.querySelectorAll('.page-content');

  navLinks.forEach(link => {
    link.addEventListener('click', (e) => {
      e.preventDefault();
      const targetPage = link.dataset.page;

      // Update active nav link
      navLinks.forEach(l => l.classList.remove('active'));
      link.classList.add('active');

      // Show target page
      pages.forEach(p => p.classList.remove('active'));
      document.getElementById(`page-${targetPage}`).classList.add('active');

      if (targetPage === 'summary') { loadOverview(); loadSummary(); }
    });
  });
}

function setupEventListeners() {
  // Set today's date as default
  document.getElementById('date').valueAsDate = new Date();

  // Auto-calculate total when quantity or price changes
  function recalcSharesTotal() {
    const qty = parseFloat(document.getElementById('quantity').value) || 0;
    const px = parseFloat(document.getElementById('price').value) || 0;
    if (qty > 0 && px > 0) {
      document.getElementById('shares-total').value = (qty * px).toFixed(2);
    }
  }
  document.getElementById('quantity').addEventListener('input', recalcSharesTotal);
  document.getElementById('price').addEventListener('input', recalcSharesTotal);

  // Transaction type change handler
  document.getElementById('type').addEventListener('change', (e) => {
    const type = e.target.value;
    const isCashOnly = type === 'DIVIDEND' || type === 'CONTRIBUTION' || type === 'WITHDRAWAL';
    const isCashFlow = type === 'CONTRIBUTION' || type === 'WITHDRAWAL';
    const sharesFields = document.getElementById('shares-fields');
    const dividendField = document.getElementById('dividend-field');
    const quantityInput = document.getElementById('quantity');
    const priceInput = document.getElementById('price');
    const totalInput = document.getElementById('total');
    const dateInput = document.getElementById('date');
    const dateDividendInput = document.getElementById('date-dividend');
    const tickerGroup = document.getElementById('ticker-group');
    const tickerInput = document.getElementById('ticker');
    const amountLabel = document.getElementById('cash-amount-label');

    if (isCashOnly) {
      sharesFields.style.display = 'none';
      dividendField.style.display = 'grid';
      quantityInput.required = false;
      priceInput.required = false;
      totalInput.required = true;
      quantityInput.value = '';
      priceInput.value = '';
      document.getElementById('shares-total').value = '';
      dateDividendInput.value = dateInput.value;
      amountLabel.textContent = isCashFlow ? 'Amount' : 'Total Amount';
      tickerGroup.style.display = isCashFlow ? 'none' : '';
      tickerInput.required = !isCashFlow;
    } else {
      sharesFields.style.display = 'grid';
      dividendField.style.display = 'none';
      quantityInput.required = true;
      priceInput.required = true;
      totalInput.required = false;
      totalInput.value = '';
      dateInput.value = dateDividendInput.value || dateInput.value;
      tickerGroup.style.display = '';
      tickerInput.required = true;
      amountLabel.textContent = 'Total Amount';
    }
  });

  // Portfolio selection (Transactions page)
  document.getElementById('transaction-portfolio-select').addEventListener('change', (e) => {
    currentPortfolioId = e.target.value ? parseInt(e.target.value) : null;
    if (currentPortfolioId) {
      currentPage = 1;
      loadTransactions();
    }
  });

  // New portfolio button
  document.getElementById('new-portfolio-btn').addEventListener('click', () => {
    const form = document.getElementById('new-portfolio-form');
    form.style.display = form.style.display === 'none' ? 'block' : 'none';
  });

  // Cancel new portfolio
  document.getElementById('cancel-portfolio-btn').addEventListener('click', () => {
    document.getElementById('new-portfolio-form').style.display = 'none';
    document.getElementById('portfolio-name').value = '';
    document.getElementById('portfolio-code').value = '';
  });

  // Create portfolio
  document.getElementById('create-portfolio-btn').addEventListener('click', async () => {
    const name = document.getElementById('portfolio-name').value.trim();
    const code = document.getElementById('portfolio-code').value.trim();

    if (!name || !code) {
      alert('Please enter both name and code');
      return;
    }

    try {
      const response = await fetch('/api/portfolios', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name, code })
      });

      if (!response.ok) {
        const error = await response.json();
        throw new Error(error.error);
      }

      const portfolio = await response.json();

      document.getElementById('portfolio-name').value = '';
      document.getElementById('portfolio-code').value = '';
      document.getElementById('new-portfolio-form').style.display = 'none';

      await loadPortfolios();
      selectPortfolioTab(portfolio.id);
    } catch (error) {
      alert('Error creating portfolio: ' + error.message);
    }
  });

  // Transaction form submission
  document.getElementById('transaction-form').addEventListener('submit', async (e) => {
    e.preventDefault();

    const portfolioId = parseInt(document.getElementById('transaction-portfolio-select').value);
    if (!portfolioId) {
      alert('Please select a portfolio first');
      return;
    }

    const type = document.getElementById('type').value;
    const isCashOnly = type === 'DIVIDEND' || type === 'CONTRIBUTION' || type === 'WITHDRAWAL';
    const isCashFlow = type === 'CONTRIBUTION' || type === 'WITHDRAWAL';

    let transaction = {
      portfolio_id: portfolioId,
      ticker: isCashFlow ? 'CASH' : document.getElementById('ticker').value.trim().toUpperCase(),
      type: type,
      date: isCashOnly ? document.getElementById('date-dividend').value : document.getElementById('date').value
    };

    if (isCashOnly) {
      transaction.quantity = 0;
      transaction.price = 0;
      transaction.total = parseFloat(document.getElementById('total').value);
    } else {
      transaction.quantity = parseFloat(document.getElementById('quantity').value);
      transaction.price = parseFloat(document.getElementById('price').value);
      const enteredTotal = parseFloat(document.getElementById('shares-total').value);
      if (enteredTotal > 0) transaction.total = enteredTotal;
      const commission = parseFloat(document.getElementById('commission').value) || 0;
      if (commission > 0) transaction.commission = commission;
    }

    try {
      const response = await fetch('/api/transactions', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(transaction)
      });

      if (!response.ok) {
        throw new Error('Failed to add transaction');
      }

      // Preserve portfolio selection and reset only transaction fields
      const savedPortfolioId = document.getElementById('transaction-portfolio-select').value;
      document.getElementById('transaction-form').reset();
      document.getElementById('transaction-portfolio-select').value = savedPortfolioId;
      document.getElementById('date').valueAsDate = new Date();
      document.getElementById('shares-fields').style.display = 'grid';
      document.getElementById('dividend-field').style.display = 'none';

      currentPage = 1;
      loadTransactions();
      loadPortfolioHoldings(portfolioId);
    } catch (error) {
      alert('Error adding transaction: ' + error.message);
    }
  });

  // File upload
  document.getElementById('choose-file-btn').addEventListener('click', () => {
    document.getElementById('csv-file').click();
  });

  document.getElementById('csv-file').addEventListener('change', (e) => {
    const file = e.target.files[0];
    if (file) {
      document.getElementById('file-name').textContent = file.name;
      document.getElementById('import-csv-btn').disabled = false;

      const reader = new FileReader();
      reader.onload = (event) => {
        csvFileData = event.target.result;
      };
      reader.readAsText(file);
    }
  });

  // CSV Import
  document.getElementById('import-csv-btn').addEventListener('click', async () => {
    if (!csvFileData) {
      alert('Please select a CSV file first');
      return;
    }

    const importBtn = document.getElementById('import-csv-btn');
    const statusDiv = document.getElementById('import-status');
    const originalBtnText = importBtn.innerHTML;

    try {
      // Show loading state
      importBtn.disabled = true;
      importBtn.innerHTML = 'Importing<span class="spinner"></span>';
      statusDiv.style.display = 'none';

      const response = await fetch('/api/import/csv', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ csvData: csvFileData })
      });

      if (!response.ok) {
        throw new Error('Failed to import CSV');
      }

      const result = await response.json();
      statusDiv.style.display = 'block';

      if (result.imported === 0 && result.errors === 0) {
        statusDiv.className = 'import-status error';
        statusDiv.innerHTML = `
          <strong>No data imported</strong><br>
          The CSV file appears to be empty or has no valid data rows.<br>
          Expected format: Date, Symbol, Portfolio, Type, Quantity, Share Price, Total
          <button onclick="this.parentElement.style.display='none'" style="margin-top: 0.5rem; padding: 0.25rem 0.5rem; cursor: pointer;">Dismiss</button>
        `;
      } else if (result.errors && result.errors > 0) {
        statusDiv.className = 'import-status error';
        statusDiv.innerHTML = `
          <strong>Import completed with errors:</strong><br>
          Imported: ${result.imported} transactions<br>
          Errors: ${result.errors}<br>
          <details style="margin-top: 0.5rem;">
            <summary>View error details</summary>
            <pre style="margin-top: 0.5rem; font-size: 0.85rem; white-space: pre-wrap;">${JSON.stringify(result.details.errors, null, 2)}</pre>
          </details>
          <button onclick="this.parentElement.style.display='none'" style="margin-top: 0.5rem; padding: 0.25rem 0.5rem; cursor: pointer;">Dismiss</button>
        `;
      } else {
        statusDiv.className = 'import-status success';
        statusDiv.innerHTML = `
          <strong>Success!</strong> Imported ${result.imported} transactions.
          <button onclick="this.parentElement.style.display='none'" style="margin-top: 0.5rem; padding: 0.25rem 0.5rem; cursor: pointer;">Dismiss</button>
        `;
      }

      csvFileData = null;
      document.getElementById('csv-file').value = '';
      document.getElementById('file-name').textContent = '';
      importBtn.disabled = true;
      importBtn.innerHTML = originalBtnText;

      loadPortfolios();
    } catch (error) {
      statusDiv.style.display = 'block';
      statusDiv.className = 'import-status error';
      statusDiv.innerHTML = `
        <strong>Error importing CSV:</strong> ${error.message}
        <button onclick="this.parentElement.style.display='none'" style="margin-top: 0.5rem; padding: 0.25rem 0.5rem; cursor: pointer;">Dismiss</button>
      `;
      importBtn.disabled = true;
      importBtn.innerHTML = originalBtnText;
    }
  });

  // Pagination
  document.getElementById('prev-page').addEventListener('click', () => {
    if (currentPage > 1) {
      currentPage--;
      displayTransactions();
    }
  });

  document.getElementById('next-page').addEventListener('click', () => {
    const totalPages = Math.ceil(allTransactions.length / TRANSACTIONS_PER_PAGE);
    if (currentPage < totalPages) {
      currentPage++;
      displayTransactions();
    }
  });
}

// Load all portfolios
async function loadPortfolios() {
  try {
    const response = await fetch('/api/portfolios');
    const portfolios = await response.json();

    // Populate transaction portfolio select
    const select = document.getElementById('transaction-portfolio-select');
    select.innerHTML = '<option value="">Select a portfolio...</option>';
    portfolios.forEach(portfolio => {
      const option = document.createElement('option');
      option.value = portfolio.id;
      option.textContent = `${portfolio.name} (${portfolio.code})`;
      select.appendChild(option);
    });

    // Create portfolio tabs
    createPortfolioTabs(portfolios);
  } catch (error) {
    console.error('Error loading portfolios:', error);
  }
}

async function setCashBalance(portfolioId, code, current) {
  const input = prompt(
    `Cash balance for ${code}:\n(Leave blank to clear and revert to computed)`,
    current != null ? current : ''
  );
  if (input === null) return; // cancelled
  const value = input.trim() === '' ? null : parseFloat(input.replace(/[$,\s]/g, ''));
  if (input.trim() !== '' && isNaN(value)) { alert('Please enter a valid number.'); return; }
  try {
    const res = await fetch(`/api/portfolios/${portfolioId}/cash-balance`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ cash_balance: value })
    });
    if (!res.ok) throw new Error((await res.json()).error);
    await loadOverview();
  } catch (e) { alert('Error: ' + e.message); }
}

async function loadOverview() {
  const container = document.getElementById('overview-container');
  try {
    const response = await fetch('/api/overview');
    const data = await response.json();

    if (!data.length) { container.innerHTML = ''; return; }

    const fmt = fmtCurrency;
    const totalCash     = data.reduce((s, p) => s + (p.cash ?? 0), 0);
    const totalInvested = data.reduce((s, p) => s + p.cash_invested, 0);
    const totalMkt      = data.reduce((s, p) => s + p.market_value, 0);
    const allCashSet    = data.every(p => p.cash !== null);

    function cashCell(p) {
      const safeCode = escapeAttrJs(p.code);
      if (p.cash === null) {
        return `<td><button class="btn-set-cash" onclick="setCashBalance(${p.id}, '${safeCode}')">Set</button></td>`;
      }
      return `<td class="${p.cash < 0 ? 'negative' : ''}">
        ${fmt(p.cash)}
        <button class="btn-edit-cash" title="Edit" onclick="setCashBalance(${p.id}, '${safeCode}', ${p.cash})">✎</button>
      </td>`;
    }

    container.innerHTML = `
      <div class="overview-table-wrap">
        <table class="overview-table">
          <thead><tr>
            <th></th>
            ${data.map(p => `<th title="${escapeHtml(p.name)}">${escapeHtml(p.code)}</th>`).join('')}
            <th>Total</th>
          </tr></thead>
          <tbody>
            <tr>
              <th>Cash Balance</th>
              ${data.map(cashCell).join('')}
              <td>${allCashSet ? fmt(totalCash) : '—'}</td>
            </tr>
            <tr>
              <th>Cash Invested</th>
              ${data.map(p => `<td>${fmt(p.cash_invested)}</td>`).join('')}
              <td>${fmt(totalInvested)}</td>
            </tr>
            <tr>
              <th>Market Value</th>
              ${data.map(p => `<td>${p.market_value > 0 ? fmt(p.market_value) : '—'}</td>`).join('')}
              <td>${totalMkt > 0 ? fmt(totalMkt) : '—'}</td>
            </tr>
          </tbody>
        </table>
      </div>`;
  } catch (error) {
    container.innerHTML = `<p class="empty-state">Error loading overview.</p>`;
  }
}

async function loadSummary() {
  const tbody = document.getElementById('summary-tbody');
  const table = document.getElementById('summary-table');
  const emptyEl = document.getElementById('summary-empty');
  tbody.innerHTML = '<tr><td colspan="28" class="empty-state">Loading...</td></tr>';
  table.style.display = 'table';
  if (emptyEl) emptyEl.style.display = 'none';
  try {
    const response = await fetch('/api/summary');
    const holdings = await response.json();

    if (holdings.length === 0) {
      table.style.display = 'none';
      if (emptyEl) emptyEl.style.display = '';
      tbody.innerHTML = '';
      return;
    }

    const totalMktValue = holdings.reduce((s, h) => s + h.market_value, 0);

    const thead = document.getElementById('summary-thead');
    if (thead && !thead.hasChildNodes()) {
      thead.innerHTML = `<tr>
        <th>Port</th><th>Type</th><th>Ticker</th><th>Shares</th>
        <th>Buy Price</th><th>Mkt Price</th><th>Sale Price</th>
        <th>Buy Total</th><th>Mkt Value</th><th>Sale Total</th>
        <th>Divs Paid</th><th>Div Freq</th><th>Last Div Date</th>
        <th>Div/Share</th><th>Next Payout</th><th>Annual Payout</th>
        <th>Return</th><th>Return %</th><th>Yield</th>
        <th>Buys</th><th>Sells</th><th>Buy Exp</th><th>Sale Exp</th>
        <th>Proceeds</th><th>ACB</th><th>Total Exp</th>
        <th>Sector</th><th>Port %</th>
      </tr>`;
    }

    const fmt  = fmtCurrencyOr;
    const fmtN = v => v ? v.toFixed(4) : '—';
    const fmtP = v => v ? v.toFixed(2) + '%' : '—';

    tbody.innerHTML = holdings.map(h => {
      const portShare = totalMktValue > 0 ? (h.market_value / totalMktValue * 100) : 0;
      const retClass  = h.return >= 0 ? 'positive' : 'negative';
      return `<tr>
        <td>${escapeHtml(h.portfolio_code)}</td>
        <td>${escapeHtml(h.investment_type)}</td>
        <td class="ticker-cell">${escapeHtml(h.ticker)}</td>
        <td>${fmtN(h.shares)}</td>
        <td>${fmt(h.buy_price)}</td>
        <td>${h.market_price > 0 ? fmt(h.market_price) : '—'}</td>
        <td>${h.sale_price > 0 ? fmt(h.sale_price) : '—'}</td>
        <td>${fmt(h.buy_total)}</td>
        <td>${h.market_price > 0 ? fmt(h.market_value) : '—'}</td>
        <td>${h.sale_total > 0 ? fmt(h.sale_total) : '—'}</td>
        <td>${h.dividends_paid > 0 ? fmt(h.dividends_paid) : '—'}</td>
        <td>${escapeHtml(h.dividend_frequency) || '—'}</td>
        <td>${escapeHtml(h.last_dividend_date) || '—'}</td>
        <td>${h.dividend_per_share > 0 ? fmt(h.dividend_per_share) : '—'}</td>
        <td>${h.next_payout > 0 ? fmt(h.next_payout) : '—'}</td>
        <td>${h.annual_payout > 0 ? fmt(h.annual_payout) : '—'}</td>
        <td class="${retClass}">${h.market_price > 0 ? fmt(h.return) : '—'}</td>
        <td class="${retClass}">${h.market_price > 0 ? fmtP(h.return_percent) : '—'}</td>
        <td>${h.market_price > 0 && h.dividend_yield > 0 ? fmtP(h.dividend_yield) : '—'}</td>
        <td>${h.buy_count}</td>
        <td>${h.sell_count}</td>
        <td>${h.buy_expense > 0 ? fmt(h.buy_expense) : '—'}</td>
        <td>${h.sale_expense > 0 ? fmt(h.sale_expense) : '—'}</td>
        <td>${h.sale_total > 0 ? fmt(h.proceeds) : '—'}</td>
        <td>${fmt(h.acb)}</td>
        <td>${h.total_expense > 0 ? fmt(h.total_expense) : '—'}</td>
        <td>${escapeHtml(h.sector) || '—'}</td>
        <td>${totalMktValue > 0 ? fmtP(portShare) : '—'}</td>
      </tr>`;
    }).join('');
  } catch (error) {
    tbody.innerHTML = `<tr><td colspan="28" class="empty-state">Error loading summary.</td></tr>`;
  }
}

// Create portfolio tabs
function createPortfolioTabs(portfolios) {
  const tabsContainer = document.getElementById('portfolio-tabs');

  if (portfolios.length === 0) {
    tabsContainer.innerHTML = '<p class="empty-state">No portfolios yet. Create your first portfolio to get started!</p>';
    return;
  }

  tabsContainer.innerHTML = '';
  portfolios.forEach(portfolio => {
    const tab = document.createElement('button');
    tab.className = 'portfolio-tab';
    tab.textContent = `${portfolio.name} (${portfolio.code})`;
    tab.dataset.portfolioId = portfolio.id;
    tab.draggable = true;

    tab.addEventListener('click', () => {
      selectPortfolioTab(portfolio.id);
    });

    // Drag and drop events
    tab.addEventListener('dragstart', handleDragStart);
    tab.addEventListener('dragover', handleDragOver);
    tab.addEventListener('drop', handleDrop);
    tab.addEventListener('dragend', handleDragEnd);
    tab.addEventListener('dragleave', handleDragLeave);

    tabsContainer.appendChild(tab);
  });

  // Select first tab by default
  if (portfolios.length > 0 && !currentPortfolioId) {
    selectPortfolioTab(portfolios[0].id);
  }
}

// Select portfolio tab
function selectPortfolioTab(portfolioId) {
  currentPortfolioId = portfolioId;

  const tabs = document.querySelectorAll('.portfolio-tab');
  tabs.forEach(tab => {
    if (parseInt(tab.dataset.portfolioId) === portfolioId) {
      tab.classList.add('active');
    } else {
      tab.classList.remove('active');
    }
  });

  // Show/hide refresh button
  const refreshBtn = document.getElementById('refresh-prices-btn');
  if (refreshBtn) {
    refreshBtn.style.display = 'inline-block';
  }

  loadPortfolioHoldings(portfolioId);
}

function setHoldingsView(view) {
  holdingsView = view;
  document.getElementById('portfolio-grid').style.display = view === 'card' ? '' : 'none';
  document.getElementById('portfolio-list').style.display = view === 'list' ? '' : 'none';
  document.getElementById('card-view-btn').classList.toggle('active', view === 'card');
  document.getElementById('list-view-btn').classList.toggle('active', view === 'list');
}

// Load portfolio holdings
async function loadPortfolioHoldings(portfolioId) {
  if (!portfolioId) return;

  try {
    const response = await fetch(`/api/portfolios/${portfolioId}/summary`);
    const portfolio = (await response.json()).filter(h => h.shares > 0.00005);

    const grid = document.getElementById('portfolio-grid');
    const listTbody = document.getElementById('holdings-list-tbody');

    if (portfolio.length === 0) {
      grid.innerHTML = '<p class="empty-state">No holdings yet. Add your first transaction!</p>';
      listTbody.innerHTML = '<tr><td colspan="10" class="empty-state">No holdings yet.</td></tr>';
      document.getElementById('view-toggle').style.display = 'none';
      return;
    }

    document.getElementById('view-toggle').style.display = '';
    setHoldingsView(holdingsView);

    // List view
    const fmtP = v => v ? v.toFixed(2) + '%' : '—';
    listTbody.innerHTML = portfolio.map(holding => {
      const retClass = holding.return >= 0 ? 'positive' : 'negative';
      const eTicker  = escapeAttrJs(holding.ticker);
      const eFreq    = escapeAttrJs(holding.dividend_frequency || '');
      const eDate    = escapeAttrJs(holding.last_dividend_date || '');
      const eSector  = escapeAttrJs(holding.sector || '');
      const eType    = escapeAttrJs(holding.investment_type || '');
      return `<tr>
        <td class="ticker-cell">${escapeHtml(holding.ticker)}</td>
        <td>${holding.shares.toFixed(4)}</td>
        <td>${fmtCurrency(holding.buy_price)}</td>
        <td>${holding.market_price > 0 ? fmtCurrency(holding.market_price) : '—'}</td>
        <td>${fmtCurrencyOr(holding.dividends_paid)}</td>
        <td>${escapeHtml(holding.last_dividend_date) || '—'}</td>
        <td class="${holding.market_price > 0 ? retClass : ''}">${holding.market_price > 0 ? fmtCurrency(holding.return) : '—'}</td>
        <td class="${holding.market_price > 0 ? retClass : ''}">${holding.market_price > 0 ? fmtP(holding.return_percent) : '—'}</td>
        <td>${holding.market_price > 0 && holding.dividend_yield > 0 ? fmtP(holding.dividend_yield) : '—'}</td>
        <td>
          <button class="btn-edit" onclick="openStockInfoModal(${portfolioId}, '${eTicker}', ${holding.market_price || 0}, '${eFreq}', ${holding.dividend_per_share || 0}, '${eDate}', '${eSector}', '${eType}')">Edit</button>
          <button class="btn-secondary btn-sm" onclick="openHoldingTransactionsModal(${portfolioId}, '${eTicker}')">Txns</button>
        </td>
      </tr>`;
    }).join('');

    // Card view
    grid.innerHTML = portfolio.map(holding => {
      const eTicker  = escapeAttrJs(holding.ticker);
      const eFreq    = escapeAttrJs(holding.dividend_frequency || '');
      const eDate    = escapeAttrJs(holding.last_dividend_date || '');
      const eSector  = escapeAttrJs(holding.sector || '');
      const eType    = escapeAttrJs(holding.investment_type || '');
      return `
      <div class="portfolio-card">
        <div class="portfolio-card-header">
          <div class="ticker-header">
            <div class="ticker ticker-link" onclick="openHoldingTransactionsModal(${portfolioId}, '${eTicker}')">${escapeHtml(holding.ticker)}</div>
            <div class="shares">${holding.shares.toFixed(2)} shares</div>
          </div>
          <button class="btn-edit" onclick="openStockInfoModal(${portfolioId}, '${eTicker}', ${holding.market_price || 0}, '${eFreq}', ${holding.dividend_per_share || 0}, '${eDate}', '${eSector}', '${eType}')">
            Edit
          </button>
        </div>

        <div class="holding-details">
          <div class="detail-row">
            <span class="label">Buy Price:</span>
            <span class="value">${fmtCurrency(holding.buy_price)}</span>
          </div>
          <div class="detail-row">
            <span class="label">Market Price:</span>
            <span class="value ${holding.market_price > 0 ? '' : 'placeholder'}">
              ${holding.market_price > 0 ? fmtCurrency(holding.market_price) : 'Not set'}
            </span>
          </div>
          <div class="detail-row">
            <span class="label">Buy Total:</span>
            <span class="value">${fmtCurrency(holding.buy_total)}</span>
          </div>
          <div class="detail-row">
            <span class="label">Market Value:</span>
            <span class="value ${holding.market_price > 0 ? '' : 'placeholder'}">
              ${holding.market_price > 0 ? fmtCurrency(holding.market_value) : 'N/A'}
            </span>
          </div>
          ${holding.sale_total > 0 ? `
            <div class="detail-row">
              <span class="label">Sale Total:</span>
              <span class="value">${fmtCurrency(holding.sale_total)}</span>
            </div>
          ` : ''}
          <div class="detail-row">
            <span class="label">Dividends Paid:</span>
            <span class="value">${fmtCurrency(holding.dividends_paid)}</span>
          </div>
          ${holding.market_price > 0 ? `
            <div class="detail-row highlight">
              <span class="label">Return:</span>
              <span class="value ${holding.return >= 0 ? 'positive' : 'negative'}">
                ${fmtCurrency(holding.return)} (${holding.return_percent.toFixed(2)}%)
              </span>
            </div>
          ` : ''}
        </div>

        ${holding.dividend_frequency ? `
          <div class="dividend-info">
            <div class="detail-row">
              <span class="label">Div Frequency:</span>
              <span class="value">${escapeHtml(holding.dividend_frequency)}</span>
            </div>
            <div class="detail-row">
              <span class="label">Div Per Share:</span>
              <span class="value">${fmtCurrency(holding.dividend_per_share)}</span>
            </div>
            <div class="detail-row">
              <span class="label">Annual Payout:</span>
              <span class="value">${fmtCurrency(holding.annual_payout)}</span>
            </div>
            ${holding.market_price > 0 ? `
              <div class="detail-row">
                <span class="label">Yield:</span>
                <span class="value">${holding.dividend_yield.toFixed(2)}%</span>
              </div>
            ` : ''}
          </div>
        ` : ''}
      </div>
    `;
    }).join('');
  } catch (error) {
    console.error('Error loading portfolio:', error);
  }
}

// Load transaction history
async function loadTransactions() {
  if (!currentPortfolioId) return;

  try {
    const response = await fetch(`/api/portfolios/${currentPortfolioId}/transactions`);
    allTransactions = await response.json();

    displayTransactions();
  } catch (error) {
    console.error('Error loading transactions:', error);
  }
}

// Display paginated transactions
function displayTransactions() {
  const list = document.getElementById('transactions-list');

  if (allTransactions.length === 0) {
    list.innerHTML = '<p class="empty-state">No transactions yet.</p>';
    document.getElementById('pagination').style.display = 'none';
    return;
  }

  const start = (currentPage - 1) * TRANSACTIONS_PER_PAGE;
  const end = start + TRANSACTIONS_PER_PAGE;
  const pageTransactions = allTransactions.slice(start, end);

  list.innerHTML = pageTransactions.map(t => {
    const typeClass = t.type.toLowerCase().replace('_', '-');
    const typeLabel = t.type.replace('_', ' ');

    return `
      <div class="transaction-item ${typeClass}">
        <div class="ticker">${escapeHtml(t.ticker)}</div>
        <div class="type ${typeClass}">${escapeHtml(typeLabel)}</div>
        <div>${t.quantity} shares</div>
        <div>${fmtCurrency(parseFloat(t.price))}/share</div>
        <div>Total: ${fmtCurrency(parseFloat(t.total))}</div>
        <div>${new Date(t.date).toLocaleDateString()}</div>
        <button class="btn-delete" onclick="deleteTransaction(${t.id})">Delete</button>
      </div>
    `;
  }).join('');

  // Update pagination
  const totalPages = Math.ceil(allTransactions.length / TRANSACTIONS_PER_PAGE);
  document.getElementById('page-info').textContent = `Page ${currentPage} of ${totalPages}`;
  document.getElementById('prev-page').disabled = currentPage === 1;
  document.getElementById('next-page').disabled = currentPage === totalPages;
  document.getElementById('pagination').style.display = 'flex';
}

// Delete transaction
async function deleteTransaction(id) {
  if (!confirm('Are you sure you want to delete this transaction?')) {
    return;
  }

  try {
    const response = await fetch(`/api/transactions/${id}`, {
      method: 'DELETE'
    });

    if (!response.ok) {
      throw new Error('Failed to delete transaction');
    }

    loadTransactions();
    loadPortfolioHoldings(currentPortfolioId);
  } catch (error) {
    alert('Error deleting transaction: ' + error.message);
  }
}

// ===== DRAG AND DROP FOR PORTFOLIO TABS =====

let draggedElement = null;

function handleDragStart(e) {
  draggedElement = e.target;
  e.target.classList.add('dragging');
  e.dataTransfer.effectAllowed = 'move';
  e.dataTransfer.setData('text/html', e.target.innerHTML);
}

function handleDragOver(e) {
  if (e.preventDefault) {
    e.preventDefault();
  }
  e.dataTransfer.dropEffect = 'move';

  const target = e.target.closest('.portfolio-tab');
  if (target && target !== draggedElement) {
    target.classList.add('drag-over');
  }

  return false;
}

function handleDragLeave(e) {
  e.target.classList.remove('drag-over');
}

function handleDrop(e) {
  if (e.stopPropagation) {
    e.stopPropagation();
  }

  const target = e.target.closest('.portfolio-tab');

  if (draggedElement && target && draggedElement !== target) {
    // Get the container
    const container = target.parentNode;

    // Get all tabs
    const allTabs = Array.from(container.querySelectorAll('.portfolio-tab'));
    const draggedIndex = allTabs.indexOf(draggedElement);
    const targetIndex = allTabs.indexOf(target);

    // Reorder in DOM
    if (draggedIndex < targetIndex) {
      target.parentNode.insertBefore(draggedElement, target.nextSibling);
    } else {
      target.parentNode.insertBefore(draggedElement, target);
    }

    // Update display_order in database
    updatePortfolioOrder();
  }

  target.classList.remove('drag-over');

  return false;
}

function handleDragEnd(e) {
  e.target.classList.remove('dragging');

  // Remove drag-over class from all tabs
  document.querySelectorAll('.portfolio-tab').forEach(tab => {
    tab.classList.remove('drag-over');
  });

  draggedElement = null;
}

async function updatePortfolioOrder() {
  const tabs = document.querySelectorAll('.portfolio-tab');

  // Update each portfolio's display_order
  const updates = Array.from(tabs).map((tab, index) => {
    const portfolioId = tab.dataset.portfolioId;
    return fetch(`/api/portfolios/${portfolioId}/order`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ display_order: index + 1 })
    });
  });

  try {
    await Promise.all(updates);
    console.log('Portfolio order updated successfully');
  } catch (error) {
    console.error('Error updating portfolio order:', error);
    alert('Failed to save portfolio order');
  }
}

// ===== STOCK INFO MODAL =====

function openStockInfoModal(portfolioId, ticker, marketPrice, dividendFreq, dividendPerShare, lastDivDate, sector, investmentType) {
  document.getElementById('edit-portfolio-id').value = portfolioId;
  document.getElementById('edit-ticker').value = ticker;
  document.getElementById('edit-stock-title').textContent = `Stock: ${ticker}`;
  document.getElementById('edit-market-price').value = marketPrice || '';
  document.getElementById('edit-dividend-frequency').value = dividendFreq || '';
  document.getElementById('edit-dividend-per-share').value = dividendPerShare || '';
  document.getElementById('edit-last-dividend-date').value = lastDivDate || '';
  document.getElementById('edit-sector').value = sector || '';
  document.getElementById('edit-investment-type').value = investmentType || '';

  document.getElementById('stock-info-modal').style.display = 'flex';
}

function closeStockInfoModal() {
  document.getElementById('stock-info-modal').style.display = 'none';
  document.getElementById('stock-info-form').reset();
}

// Handle stock info form submission
document.getElementById('stock-info-form').addEventListener('submit', async (e) => {
  e.preventDefault();

  const portfolioId = document.getElementById('edit-portfolio-id').value;
  const ticker = document.getElementById('edit-ticker').value;
  const marketPrice = parseFloat(document.getElementById('edit-market-price').value) || null;
  const dividendFrequency = document.getElementById('edit-dividend-frequency').value || null;
  const dividendPerShare = parseFloat(document.getElementById('edit-dividend-per-share').value) || null;
  const lastDividendDate = document.getElementById('edit-last-dividend-date').value || null;
  const sector         = document.getElementById('edit-sector').value || null;
  const investmentType = document.getElementById('edit-investment-type').value || null;

  try {
    const response = await fetch(`/api/portfolios/${portfolioId}/stocks/${ticker}`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        market_price: marketPrice,
        dividend_frequency: dividendFrequency,
        dividend_per_share: dividendPerShare,
        last_dividend_date: lastDividendDate,
        sector: sector,
        investment_type: investmentType
      })
    });

    if (!response.ok) {
      throw new Error('Failed to update stock info');
    }

    closeStockInfoModal();
    loadPortfolioHoldings(portfolioId);
    alert('Stock information updated successfully!');
  } catch (error) {
    console.error('Error updating stock info:', error);
    alert('Error updating stock info: ' + error.message);
  }
});

// Close modal when clicking outside
document.getElementById('stock-info-modal').addEventListener('click', (e) => {
  if (e.target.id === 'stock-info-modal') {
    closeStockInfoModal();
  }
});

// ===== HOLDING TRANSACTIONS MODAL =====

async function openHoldingTransactionsModal(portfolioId, ticker) {
  document.getElementById('holding-transactions-title').textContent = `${ticker} — Transactions`;
  document.getElementById('holding-transactions-tbody').innerHTML = '<tr><td colspan="6" class="empty-state">Loading…</td></tr>';
  document.getElementById('holding-transactions-summary').innerHTML = '';
  document.getElementById('holding-transactions-modal').style.display = 'flex';

  try {
    const res = await fetch(`/api/portfolios/${portfolioId}/transactions/ticker/${ticker}`);
    const txns = await res.json();

    if (!txns.length) {
      document.getElementById('holding-transactions-tbody').innerHTML =
        '<tr><td colspan="6" class="empty-state">No transactions found.</td></tr>';
      return;
    }

    const typeLabel = t => t.replace('_', ' ');
    const typeClass = t => t.toLowerCase().replace('_', '-');

    let totalShares = 0, totalCost = 0, totalCommission = 0;
    document.getElementById('holding-transactions-tbody').innerHTML = txns.map(t => {
      const isBuy  = t.type === 'BUY' || t.type === 'DIVIDEND_REINVEST';
      const isSell = t.type === 'SELL';
      if (isBuy)  { totalShares += t.quantity; totalCost += t.total; totalCommission += (t.commission || 0); }
      if (isSell) { totalShares -= t.quantity; }
      return `<tr>
        <td>${t.date}</td>
        <td><span class="type ${typeClass(t.type)}">${escapeHtml(typeLabel(t.type))}</span></td>
        <td>${t.quantity > 0 ? t.quantity.toFixed(4) : '—'}</td>
        <td>${t.price > 0 ? fmtCurrency(t.price) : '—'}</td>
        <td>${fmtCurrency(t.total)}</td>
        <td>${t.commission > 0 ? fmtCurrency(t.commission) : '—'}</td>
      </tr>`;
    }).join('');

    const acbPerShare = totalShares > 0 ? (totalCost + totalCommission) / (totalShares + (totalShares < 0 ? 0 : 0)) : 0;
    document.getElementById('holding-transactions-summary').innerHTML = `
      <div class="tx-summary-row">
        <span><strong>Net Shares:</strong> ${totalShares.toFixed(4)}</span>
        <span><strong>Total Cost:</strong> ${fmtCurrency(totalCost)}</span>
        <span><strong>Total Commission:</strong> ${totalCommission > 0 ? fmtCurrency(totalCommission) : '—'}</span>
        <span><strong>ACB / Share:</strong> ${totalShares > 0 ? fmtCurrency((totalCost + totalCommission) / totalShares) : '—'}</span>
      </div>`;
  } catch (e) {
    document.getElementById('holding-transactions-tbody').innerHTML =
      `<tr><td colspan="6" class="empty-state">Error: ${e.message}</td></tr>`;
  }
}

function closeHoldingTransactionsModal() {
  document.getElementById('holding-transactions-modal').style.display = 'none';
}

document.getElementById('holding-transactions-modal').addEventListener('click', (e) => {
  if (e.target.id === 'holding-transactions-modal') closeHoldingTransactionsModal();
});

// ===== REFRESH PRICES (TMX) =====

async function runRefresh(url, btn, statusEl, onSuccess) {
  const original = btn.innerHTML;
  btn.disabled = true;
  btn.innerHTML = 'Refreshing…';
  if (statusEl) { statusEl.style.display = 'none'; }
  try {
    const res = await fetch(url, { method: 'POST' });
    if (!res.ok) { const e = await res.json(); throw new Error(e.error || 'Failed'); }
    const result = await res.json();
    if (onSuccess) await onSuccess(result);
    let msg = `<strong>${escapeHtml(result.message)}</strong>`;
    if (result.errors?.length) {
      msg += `<br><details style="margin-top:.5rem"><summary>${result.errors.length} error(s)</summary>` +
             result.errors.map(e => `${escapeHtml(e.ticker)}: ${escapeHtml(e.error)}`).join('<br>') + '</details>';
    }
    if (statusEl) {
      statusEl.className = 'import-status success';
      statusEl.innerHTML = msg;
      statusEl.style.display = 'block';
    } else {
      alert(result.message + (result.errors?.length ? `\n\nErrors: ${result.errors.map(e=>`${e.ticker}: ${e.error}`).join(', ')}` : ''));
    }
  } catch (error) {
    if (statusEl) {
      statusEl.className = 'import-status error';
      statusEl.innerHTML = `<strong>Error:</strong> ${error.message}`;
      statusEl.style.display = 'block';
    } else {
      alert('Error refreshing prices: ' + error.message);
    }
  } finally {
    btn.disabled = false;
    btn.innerHTML = original;
  }
}

// Per-portfolio refresh (Portfolios page)
document.getElementById('refresh-prices-btn').addEventListener('click', () => {
  if (!currentPortfolioId) { alert('Please select a portfolio first'); return; }
  const btn = document.getElementById('refresh-prices-btn');
  runRefresh(`/api/portfolios/${currentPortfolioId}/refresh-prices`, btn, null,
    async () => { await loadPortfolioHoldings(currentPortfolioId); });
});

// Refresh all portfolios (Summary page)
document.getElementById('refresh-all-btn').addEventListener('click', () => {
  const btn = document.getElementById('refresh-all-btn');
  const status = document.getElementById('refresh-all-status');
  runRefresh('/api/refresh-all-prices', btn, status,
    async () => { await loadOverview(); await loadSummary(); });
});
