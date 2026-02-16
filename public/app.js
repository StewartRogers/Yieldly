let currentPortfolioId = null;
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
    });
  });
}

function setupEventListeners() {
  // Set today's date as default
  document.getElementById('date').valueAsDate = new Date();

  // Transaction type change handler
  document.getElementById('type').addEventListener('change', (e) => {
    const isDividend = e.target.value === 'DIVIDEND';
    const sharesFields = document.getElementById('shares-fields');
    const dividendField = document.getElementById('dividend-field');
    const quantityInput = document.getElementById('quantity');
    const priceInput = document.getElementById('price');
    const totalInput = document.getElementById('total');
    const dateInput = document.getElementById('date');
    const dateDividendInput = document.getElementById('date-dividend');

    if (isDividend) {
      sharesFields.style.display = 'none';
      dividendField.style.display = 'grid';
      quantityInput.required = false;
      priceInput.required = false;
      totalInput.required = true;
      quantityInput.value = '';
      priceInput.value = '';
      dateDividendInput.value = dateInput.value;
    } else {
      sharesFields.style.display = 'grid';
      dividendField.style.display = 'none';
      quantityInput.required = true;
      priceInput.required = true;
      totalInput.required = false;
      totalInput.value = '';
      dateInput.value = dateDividendInput.value || dateInput.value;
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
    const isDividend = type === 'DIVIDEND';

    let transaction = {
      portfolio_id: portfolioId,
      ticker: document.getElementById('ticker').value.trim(),
      type: type,
      date: isDividend ? document.getElementById('date-dividend').value : document.getElementById('date').value
    };

    if (isDividend) {
      transaction.quantity = 0;
      transaction.price = 0;
      transaction.total = parseFloat(document.getElementById('total').value);
    } else {
      transaction.quantity = parseFloat(document.getElementById('quantity').value);
      transaction.price = parseFloat(document.getElementById('price').value);
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

      document.getElementById('transaction-form').reset();
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

    try {
      const response = await fetch('/api/import/csv', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ csvData: csvFileData })
      });

      if (!response.ok) {
        throw new Error('Failed to import CSV');
      }

      const result = await response.json();
      const statusDiv = document.getElementById('import-status');

      if (result.errors && result.errors.length > 0) {
        statusDiv.className = 'import-status error';
        statusDiv.innerHTML = `
          <strong>Import completed with errors:</strong><br>
          Imported: ${result.imported} transactions<br>
          Errors: ${result.errors}<br>
          <details style="margin-top: 0.5rem;">
            <summary>View error details</summary>
            <pre style="margin-top: 0.5rem; font-size: 0.85rem;">${JSON.stringify(result.details.errors, null, 2)}</pre>
          </details>
        `;
      } else {
        statusDiv.className = 'import-status success';
        statusDiv.innerHTML = `<strong>Success!</strong> Imported ${result.imported} transactions.`;
      }

      csvFileData = null;
      document.getElementById('csv-file').value = '';
      document.getElementById('file-name').textContent = '';
      document.getElementById('import-csv-btn').disabled = true;

      setTimeout(() => {
        statusDiv.style.display = 'none';
      }, 5000);

      loadPortfolios();
    } catch (error) {
      const statusDiv = document.getElementById('import-status');
      statusDiv.className = 'import-status error';
      statusDiv.textContent = 'Error importing CSV: ' + error.message;
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

    tab.addEventListener('click', () => {
      selectPortfolioTab(portfolio.id);
    });

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

  loadPortfolioHoldings(portfolioId);
}

// Load portfolio holdings
async function loadPortfolioHoldings(portfolioId) {
  if (!portfolioId) return;

  try {
    const response = await fetch(`/api/portfolios/${portfolioId}/summary`);
    const portfolio = await response.json();

    const grid = document.getElementById('portfolio-grid');

    if (portfolio.length === 0) {
      grid.innerHTML = '<p class="empty-state">No holdings yet. Add your first transaction!</p>';
      return;
    }

    grid.innerHTML = portfolio.map(holding => `
      <div class="portfolio-card">
        <div class="ticker">${holding.ticker}</div>
        <div class="shares">${holding.shares.toFixed(2)} shares</div>
        <div class="avg-cost">Avg Cost: $${holding.avgCost.toFixed(2)}</div>
        ${holding.totalDividends > 0 ? `<div class="avg-cost">Dividends: $${holding.totalDividends.toFixed(2)}</div>` : ''}
      </div>
    `).join('');
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
        <div class="ticker">${t.ticker}</div>
        <div class="type ${typeClass}">${typeLabel}</div>
        <div>${t.quantity} shares</div>
        <div>$${parseFloat(t.price).toFixed(2)}/share</div>
        <div>Total: $${parseFloat(t.total).toFixed(2)}</div>
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
