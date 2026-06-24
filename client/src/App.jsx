import { useState, useEffect } from 'react'
import { BrowserRouter, Routes, Route, NavLink } from 'react-router-dom'
import { RefreshCw, Check, LogOut } from 'lucide-react'
import { getPortfolios, refreshAllPrices, getSession, login, logout, setupAccount, setOnUnauthorized } from './api/client'
import Home from './pages/Home'
import Summary from './pages/Summary'
import Dividends from './pages/Dividends'
import Portfolios from './pages/Portfolios'
import Transactions from './pages/Transactions'
import Import from './pages/Import'
import Login from './pages/Login'

const navCls = ({ isActive }) => 'app-nav-link' + (isActive ? ' app-nav-link--active' : '')

export default function App() {
  const [authState, setAuthState] = useState({ loading: true, user: null, needsSetup: false })
  const [portfolios, setPortfolios] = useState([])

  const [pricesTick,     setPricesTick]     = useState(0)
  const [navRefreshing,  setNavRefreshing]  = useState(false)
  const [navRefreshOk,   setNavRefreshOk]   = useState(false)

  const loadPortfolios = () =>
    getPortfolios().then(setPortfolios).catch(console.error)

  useEffect(() => {
    setOnUnauthorized(() => setAuthState({ loading: false, user: null, needsSetup: false }))
    getSession()
      .then(data => {
        setAuthState({ loading: false, user: data.authenticated ? data.user : null, needsSetup: data.needsSetup })
        if (data.authenticated) loadPortfolios()
      })
      .catch(() => setAuthState({ loading: false, user: null, needsSetup: false }))
  }, [])

  const handleAuth = async (username, password) => {
    const authenticate = authState.needsSetup ? setupAccount : login
    const data = await authenticate(username, password)
    setAuthState({ loading: false, user: data.user, needsSetup: false })
    loadPortfolios()
  }

  const handleLogout = async () => {
    try { await logout() } catch { /* proceed anyway */ }
    setAuthState({ loading: false, user: null, needsSetup: false })
    setPortfolios([])
  }

  const handleNavRefresh = async () => {
    if (navRefreshing) return
    setNavRefreshing(true)
    setNavRefreshOk(false)
    try {
      await refreshAllPrices()
      setPricesTick(t => t + 1)
      setNavRefreshOk(true)
      setTimeout(() => setNavRefreshOk(false), 2000)
    } catch {
      /* silent — pages have their own error handling */
    } finally {
      setNavRefreshing(false)
    }
  }

  if (authState.loading) {
    return <div className="login-page"><p style={{ color: 'var(--tc-muted)' }}>Loading...</p></div>
  }

  if (!authState.user) {
    return <Login needsSetup={authState.needsSetup} onAuthenticated={handleAuth} />
  }

  return (
    <BrowserRouter>
      <nav className="app-nav">
        <div className="app-nav-inner">

          <NavLink to="/" className="app-nav-wordmark" aria-label="Yieldly home">
            <span className="app-nav-mark" aria-hidden="true">Y</span>
            <span className="app-nav-brand">Yieldly</span>
          </NavLink>

          <div className="app-nav-links">
            <NavLink to="/" end className={navCls}>Home</NavLink>
            <NavLink to="/summary"      className={navCls}>Summary</NavLink>
            <NavLink to="/dividends"    className={navCls}>Dividends</NavLink>
            <NavLink to="/portfolios"   className={navCls}>Portfolios</NavLink>
            <NavLink to="/transactions" className={navCls}>Transactions</NavLink>
            <NavLink to="/import"       className={navCls}>Import Data</NavLink>
          </div>

          <span style={{ flex: 1 }} aria-hidden="true" />

          <button
            className={`app-nav-icon-btn${navRefreshOk ? ' ok' : ''}`}
            onClick={handleNavRefresh}
            disabled={navRefreshing}
            title={navRefreshing ? 'Refreshing prices…' : 'Refresh all prices'}
            aria-label="Refresh all prices"
          >
            {navRefreshOk
              ? <Check size={15} />
              : <RefreshCw size={15} className={navRefreshing ? 'motion-safe:animate-spin' : ''} />
            }
          </button>

          <button
            className="app-nav-icon-btn"
            onClick={handleLogout}
            title={`Sign out (${authState.user.username})`}
            aria-label="Sign out"
          >
            <LogOut size={15} />
          </button>

        </div>
      </nav>

      <div className="app-page">
        <Routes>
          <Route path="/"             element={<Home />} />
          <Route path="/summary"      element={<Summary      pricesTick={pricesTick} />} />
          <Route path="/dividends"    element={<Dividends    portfolios={portfolios} />} />
          <Route path="/portfolios"   element={<Portfolios   portfolios={portfolios} onPortfoliosChange={loadPortfolios} pricesTick={pricesTick} />} />
          <Route path="/transactions" element={<Transactions portfolios={portfolios} />} />
          <Route path="/import"       element={<Import       onImported={loadPortfolios} />} />
        </Routes>
      </div>
    </BrowserRouter>
  )
}
