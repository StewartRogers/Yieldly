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
        <div class="portfolio-card-header">
          <div class="ticker-header">
            <div class="ticker">${holding.ticker}</div>
            <div class="shares">${holding.shares.toFixed(2)} shares</div>
          </div>
          <button class="btn-edit" onclick="openStockInfoModal(${portfolioId}, '${holding.ticker}', ${holding.market_price || 0}, '${holding.dividend_frequency || ''}', ${holding.dividend_per_share || 0}, '${holding.last_dividend_date || ''}')">
            Edit
          </button>
        </div>

        <div class="holding-details">
          <div class="detail-row">
            <span class="label">Buy Price:</span>
            <span class="value">$${holding.buy_price.toFixed(2)}</span>
          </div>
          <div class="detail-row">
            <span class="label">Market Price:</span>
            <span class="value ${holding.market_price > 0 ? '' : 'placeholder'}">
              ${holding.market_price > 0 ? '$' + holding.market_price.toFixed(2) : 'Not set'}
            </span>
          </div>
          <div class="detail-row">
            <span class="label">Buy Total:</span>
            <span class="value">$${holding.buy_total.toFixed(2)}</span>
          </div>
          <div class="detail-row">
            <span class="label">Market Value:</span>
            <span class="value ${holding.market_price > 0 ? '' : 'placeholder'}">
              ${holding.market_price > 0 ? '$' + holding.market_value.toFixed(2) : 'N/A'}
            </span>
          </div>
          ${holding.sale_total > 0 ? `
            <div class="detail-row">
              <span class="label">Sale Total:</span>
              <span class="value">$${holding.sale_total.toFixed(2)}</span>
            </div>
          ` : ''}
          <div class="detail-row">
            <span class="label">Dividends Paid:</span>
            <span class="value">$${holding.dividends_paid.toFixed(2)}</span>
          </div>
          ${holding.market_price > 0 ? `
            <div class="detail-row highlight">
              <span class="label">Return:</span>
              <span class="value ${holding.return >= 0 ? 'positive' : 'negative'}">
                $${holding.return.toFixed(2)} (${holding.return_percent.toFixed(2)}%)
              </span>
            </div>
          ` : ''}
        </div>

        ${holding.dividend_frequency ? `
          <div class="dividend-info">
            <div class="detail-row">
              <span class="label">Div Frequency:</span>
              <span class="value">${holding.dividend_frequency}</span>
            </div>
            <div class="detail-row">
              <span class="label">Div Per Share:</span>
              <span class="value">$${holding.dividend_per_share.toFixed(2)}</span>
            </div>
            <div class="detail-row">
              <span class="label">Annual Payout:</span>
              <span class="value">$${holding.annual_payout.toFixed(2)}</span>
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

function openStockInfoModal(portfolioId, ticker, marketPrice, dividendFreq, dividendPerShare, lastDivDate) {
  document.getElementById('edit-portfolio-id').value = portfolioId;
  document.getElementById('edit-ticker').value = ticker;
  document.getElementById('edit-stock-title').textContent = `Stock: ${ticker}`;
  document.getElementById('edit-market-price').value = marketPrice || '';
  document.getElementById('edit-dividend-frequency').value = dividendFreq || '';
  document.getElementById('edit-dividend-per-share').value = dividendPerShare || '';
  document.getElementById('edit-last-dividend-date').value = lastDivDate || '';

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

  try {
    const response = await fetch(`/api/portfolios/${portfolioId}/stocks/${ticker}`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        market_price: marketPrice,
        dividend_frequency: dividendFrequency,
        dividend_per_share: dividendPerShare,
        last_dividend_date: lastDividendDate
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

// ===== REFRESH PRICES FROM API =====

document.getElementById('refresh-prices-btn').addEventListener('click', async () => {
  if (!currentPortfolioId) {
    alert('Please select a portfolio first');
    return;
  }

  const refreshBtn = document.getElementById('refresh-prices-btn');
  const originalText = refreshBtn.innerHTML;

  try {
    // Show loading state
    refreshBtn.disabled = true;
    refreshBtn.innerHTML = '🔄 Refreshing<span class="spinner"></span>';

    const response = await fetch(`/api/portfolios/${currentPortfolioId}/refresh-prices`, {
      method: 'POST'
    });

    if (!response.ok) {
      const error = await response.json();
      throw new Error(error.error || 'Failed to refresh prices');
    }

    const result = await response.json();

    // Reload portfolio holdings to show updated prices
    await loadPortfolioHoldings(currentPortfolioId);

    // Show success message
    let message = result.message;
    if (result.errors && result.errors.length > 0) {
      message += `\n\nErrors:\n${result.errors.map(e => `${e.ticker}: ${e.error}`).join('\n')}`;
    }
    alert(message);

  } catch (error) {
    console.error('Error refreshing prices:', error);
    alert('Error refreshing prices: ' + error.message);
  } finally {
    refreshBtn.disabled = false;
    refreshBtn.innerHTML = originalText;
  }
});
