import { useState, useEffect } from 'react'
import { BrowserRouter, Routes, Route, NavLink } from 'react-router-dom'
import { RefreshCw, Check } from 'lucide-react'
import { getPortfolios, refreshAllPrices } from './api/client'
import Home from './pages/Home'
import Summary from './pages/Summary'
import Dividends from './pages/Dividends'
import Portfolios from './pages/Portfolios'
import Transactions from './pages/Transactions'
import Import from './pages/Import'

const navCls = ({ isActive }) => 'app-nav-link' + (isActive ? ' app-nav-link--active' : '')

export default function App() {
  const [portfolios, setPortfolios] = useState([])

  /* Global price refresh — incremented after each successful refresh so
     price-sensitive pages can watch this value in their own useEffect  */
  const [pricesTick,     setPricesTick]     = useState(0)
  const [navRefreshing,  setNavRefreshing]  = useState(false)
  const [navRefreshOk,   setNavRefreshOk]   = useState(false)

  const loadPortfolios = () =>
    getPortfolios().then(setPortfolios).catch(console.error)

  useEffect(() => { loadPortfolios() }, [])

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

  return (
    <BrowserRouter>
      <nav className="app-nav">
        <div className="app-nav-inner">

          {/* ── Brand ── */}
          <NavLink to="/" className="app-nav-wordmark" aria-label="Yieldly home">
            <span className="app-nav-mark" aria-hidden="true">Y</span>
            <span className="app-nav-brand">Yieldly</span>
          </NavLink>

          {/* ── Links ── */}
          <div className="app-nav-links">
            <NavLink to="/" end className={navCls}>Home</NavLink>
            <NavLink to="/summary"      className={navCls}>Summary</NavLink>
            <NavLink to="/dividends"    className={navCls}>Dividends</NavLink>
            <NavLink to="/portfolios"   className={navCls}>Portfolios</NavLink>
            <NavLink to="/transactions" className={navCls}>Transactions</NavLink>
            <NavLink to="/import"       className={navCls}>Import Data</NavLink>
          </div>

          {/* ── Spacer ── */}
          <span style={{ flex: 1 }} aria-hidden="true" />

          {/* ── Global refresh ── */}
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

          {/* ── Avatar ── */}
          <div className="app-nav-avatar" role="img" aria-label="Account" />

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
