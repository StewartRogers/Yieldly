import { useState, useEffect, useRef, lazy, Suspense } from 'react'
import { BrowserRouter, Routes, Route, NavLink, useLocation } from 'react-router-dom'
import { RefreshCw, Check, LogOut } from 'lucide-react'
import { getPortfolios, refreshAllPrices, getSession, login, logout, setupAccount, setOnUnauthorized } from './api/client'
import Login from './pages/Login'
import { Button } from '@/components/ui/button'

// Login is needed immediately for unauthenticated visitors, so it stays a
// normal eager import. The rest only matter once logged in, and are the
// bulk of the >500kB main chunk — lazy-loading them keeps first load light
// on slow/mobile connections; each page's JS downloads only when visited.
const Home = lazy(() => import('./pages/Home'))
const Summary = lazy(() => import('./pages/Summary'))
const History = lazy(() => import('./pages/History'))
const Dividends = lazy(() => import('./pages/Dividends'))
const Portfolios = lazy(() => import('./pages/Portfolios'))
const Transactions = lazy(() => import('./pages/Transactions'))
const Import = lazy(() => import('./pages/Import'))

const navCls = ({ isActive }) => 'app-nav-link' + (isActive ? ' app-nav-link--active' : '')

/**
 * The seven nav links do not fit a phone, so on small screens the strip
 * scrolls horizontally (see .app-nav-links in style.css). That left the
 * current page's tab off-screen — on /transactions the strip still read
 * "Home Summary History…", with nothing showing where you were. Bring the
 * active link into view on every navigation.
 *
 * `inline: 'nearest'` scrolls only the strip, and `block: 'nearest'` stops it
 * from also scrolling the page vertically.
 */
function NavLinks() {
  const location = useLocation()
  const ref = useRef(null)

  useEffect(() => {
    const active = ref.current?.querySelector('.app-nav-link--active')
    if (!active) return
    const reduced = window.matchMedia?.('(prefers-reduced-motion: reduce)').matches
    active.scrollIntoView({ behavior: reduced ? 'auto' : 'smooth', inline: 'nearest', block: 'nearest' })
  }, [location.pathname])

  return (
    <div className="app-nav-links" ref={ref}>
      <NavLink to="/" end className={navCls}>Home</NavLink>
      <NavLink to="/summary"      className={navCls}>Summary</NavLink>
      <NavLink to="/history"      className={navCls}>History</NavLink>
      <NavLink to="/dividends"    className={navCls}>Dividends</NavLink>
      <NavLink to="/portfolios"   className={navCls}>Portfolios</NavLink>
      <NavLink to="/transactions" className={navCls}>Transactions</NavLink>
      <NavLink to="/import"       className={navCls}>Import Data</NavLink>
    </div>
  )
}

export default function App() {
  const [authState, setAuthState] = useState({ loading: true, user: null, needsSetup: false, setupTokenRequired: false, error: null })
  const [portfolios, setPortfolios] = useState([])

  const [pricesTick,     setPricesTick]     = useState(0)
  const [navRefreshing,  setNavRefreshing]  = useState(false)
  const [navRefreshOk,   setNavRefreshOk]   = useState(false)

  const loadPortfolios = () =>
    getPortfolios().then(setPortfolios).catch(console.error)

  // Distinguish "session check failed" (backend 500 / network) from "needs
  // login": a failed check sets `error` and shows a retry screen rather than
  // silently rendering the login form, which would mask a real server problem.
  const checkSession = () => {
    getSession()
      .then(data => {
        setAuthState({ loading: false, user: data.authenticated ? data.user : null, needsSetup: !!data.needsSetup, setupTokenRequired: !!data.setupTokenRequired, error: null })
        if (data.authenticated) loadPortfolios()
      })
      .catch(e => setAuthState({ loading: false, user: null, needsSetup: false, setupTokenRequired: false, error: e?.message || 'Could not reach the server.' }))
  }

  // Re-run the session check on demand (retry button): flip to the loading
  // screen first, then re-check. setState here is fine — it's an event handler.
  const retrySession = () => {
    setAuthState(s => ({ ...s, loading: true, error: null }))
    checkSession()
  }

  useEffect(() => {
    setOnUnauthorized(() => setAuthState({ loading: false, user: null, needsSetup: false, setupTokenRequired: false, error: null }))
    checkSession()
    // Run once on mount — checkSession is stable for our purposes.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  // The browser's back/forward cache can restore this page from an in-memory
  // snapshot — including whatever financial data was on screen — without
  // re-running any of the above and without a network request. `persisted`
  // is only true on that kind of restore (not a normal load), so re-check
  // the session then to catch a since-expired token or a logout that
  // happened in another tab.
  useEffect(() => {
    const onPageShow = (e) => { if (e.persisted) checkSession() }
    window.addEventListener('pageshow', onPageShow)
    return () => window.removeEventListener('pageshow', onPageShow)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  const handleAuth = async (username, password, setupToken) => {
    const data = authState.needsSetup
      ? await setupAccount(username, password, setupToken)
      : await login(username, password)
    setAuthState({ loading: false, user: data.user, needsSetup: false, setupTokenRequired: false, error: null })
    loadPortfolios()
  }

  const handleLogout = async () => {
    try { await logout() } catch { /* proceed anyway */ }
    setAuthState({ loading: false, user: null, needsSetup: false, setupTokenRequired: false, error: null })
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

  if (authState.error) {
    return (
      <div className="login-page">
        <div style={{ maxWidth: '22rem', textAlign: 'center', display: 'flex', flexDirection: 'column', gap: '0.75rem' }}>
          <p style={{ fontWeight: 600 }}>We couldn’t load your session</p>
          <p style={{ color: 'var(--tc-muted)', fontSize: '0.875rem' }}>{authState.error}</p>
          <Button onClick={retrySession} className="w-fit mx-auto">Try again</Button>
        </div>
      </div>
    )
  }

  if (!authState.user) {
    return <Login needsSetup={authState.needsSetup} setupTokenRequired={authState.setupTokenRequired} onAuthenticated={handleAuth} />
  }

  return (
    <BrowserRouter>
      <nav className="app-nav">
        <div className="app-nav-inner">

          <NavLink to="/" className="app-nav-wordmark" aria-label="Yieldly home">
            <span className="app-nav-mark" aria-hidden="true">Y</span>
            <span className="app-nav-brand">Yieldly</span>
          </NavLink>

          <NavLinks />

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
        <Suspense fallback={<p style={{ color: 'var(--tc-muted)' }}>Loading...</p>}>
          <Routes>
            <Route path="/"             element={<Home />} />
            <Route path="/summary"      element={<Summary      pricesTick={pricesTick} />} />
            <Route path="/history"      element={<History      portfolios={portfolios} />} />
            <Route path="/dividends"    element={<Dividends    portfolios={portfolios} />} />
            <Route path="/portfolios"   element={<Portfolios   portfolios={portfolios} onPortfoliosChange={loadPortfolios} pricesTick={pricesTick} />} />
            <Route path="/transactions" element={<Transactions portfolios={portfolios} />} />
            <Route path="/import"       element={<Import       onImported={loadPortfolios} />} />
          </Routes>
        </Suspense>
      </div>
    </BrowserRouter>
  )
}
