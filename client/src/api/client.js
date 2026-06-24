let _onUnauthorized = null
export function setOnUnauthorized(cb) { _onUnauthorized = cb }

async function request(url, options = {}) {
  const { body, ...rest } = options
  const res = await fetch(url, {
    headers: { 'Content-Type': 'application/json' },
    ...(body !== undefined ? { body } : {}),
    ...rest,
  })
  if (res.status === 401 && !url.startsWith('/api/auth/')) {
    _onUnauthorized?.()
    throw new Error('Session expired')
  }
  if (!res.ok) {
    const data = await res.json().catch(() => ({}))
    throw new Error(data.error || `Request failed (${res.status})`)
  }
  return res.json()
}

const json = (data) => JSON.stringify(data)

// ── Auth ────────────────────────────────────────────────────────────────────
export const getSession = () =>
  request('/api/auth/session')

export const login = (username, password) =>
  request('/api/auth/login', { method: 'POST', body: json({ username, password }) })

export const logout = () =>
  request('/api/auth/logout', { method: 'POST' })

export const setupAccount = (username, password) =>
  request('/api/auth/setup', { method: 'POST', body: json({ username, password }) })

export const changePassword = (currentPassword, newPassword) =>
  request('/api/change-password', { method: 'POST', body: json({ currentPassword, newPassword }) })

// ── Portfolios ──────────────────────────────────────────────────────────────
export const getPortfolios = () =>
  request('/api/portfolios')

export const createPortfolio = (data) =>
  request('/api/portfolios', { method: 'POST', body: json(data) })

export const updatePortfolio = (id, data) =>
  request(`/api/portfolios/${id}`, { method: 'PUT', body: json(data) })

export const updatePortfolioOrder = (id, display_order) =>
  request(`/api/portfolios/${id}/order`, { method: 'PUT', body: json({ display_order }) })

export const updateCashBalance = (id, cash_balance) =>
  request(`/api/portfolios/${id}/cash-balance`, { method: 'PUT', body: json({ cash_balance }) })

export const getPortfolioSummary = (id) =>
  request(`/api/portfolios/${id}/summary`)

export const refreshPortfolioPrices = (id) =>
  request(`/api/portfolios/${id}/refresh-prices`, { method: 'POST' })

export const refreshAllPrices = () =>
  request('/api/refresh-all-prices', { method: 'POST' })

export const updateStockInfo = (portfolioId, ticker, data) =>
  request(`/api/portfolios/${portfolioId}/stocks/${ticker}`, { method: 'PUT', body: json(data) })

// ── Transactions ────────────────────────────────────────────────────────────
export const getPortfolioTransactions = (portfolioId) =>
  request(`/api/portfolios/${portfolioId}/transactions`)

export const getTickerTransactions = (portfolioId, ticker) =>
  request(`/api/portfolios/${portfolioId}/transactions/ticker/${ticker}`)

export const createTransaction = (data) =>
  request('/api/transactions', { method: 'POST', body: json(data) })

export const deleteTransaction = (id) =>
  request(`/api/transactions/${id}`, { method: 'DELETE' })

// ── Summary & Dividends ─────────────────────────────────────────────────────
export const getOverview = () =>
  request('/api/overview')

export const getMonthlyAcb = () =>
  request('/api/summary/monthly-acb')

export const getDividendsMonthly = () =>
  request('/api/dividends/monthly')

// ── Import ──────────────────────────────────────────────────────────────────
export const importCsv = (csvData) =>
  request('/api/import/csv', { method: 'POST', body: json({ csvData }) })
