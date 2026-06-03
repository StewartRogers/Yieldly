import { useState, useEffect } from 'react'
import { BrowserRouter, Routes, Route, NavLink } from 'react-router-dom'
import Home from './pages/Home'
import Summary from './pages/Summary'
import Dividends from './pages/Dividends'
import Portfolios from './pages/Portfolios'
import Transactions from './pages/Transactions'
import Import from './pages/Import'

export default function App() {
  const [portfolios, setPortfolios] = useState([])

  const loadPortfolios = () =>
    fetch('/api/portfolios')
      .then(r => r.json())
      .then(setPortfolios)
      .catch(console.error)

  useEffect(() => { loadPortfolios() }, [])

  return (
    <BrowserRouter>
      <nav className="app-nav">
        <div className="app-nav-inner">
          <NavLink to="/" className="app-nav-wordmark">
            <span className="app-nav-pipe">|</span>
            <span className="app-nav-brand">Yieldly</span>
          </NavLink>
          <div className="app-nav-links">
            <NavLink to="/" end className={({ isActive }) => 'app-nav-link' + (isActive ? ' app-nav-link--active' : '')}>Home</NavLink>
            <NavLink to="/summary" className={({ isActive }) => 'app-nav-link' + (isActive ? ' app-nav-link--active' : '')}>Summary</NavLink>
            <NavLink to="/dividends" className={({ isActive }) => 'app-nav-link' + (isActive ? ' app-nav-link--active' : '')}>Dividends</NavLink>
            <NavLink to="/portfolios" className={({ isActive }) => 'app-nav-link' + (isActive ? ' app-nav-link--active' : '')}>Portfolios</NavLink>
            <NavLink to="/transactions" className={({ isActive }) => 'app-nav-link' + (isActive ? ' app-nav-link--active' : '')}>Transactions</NavLink>
            <NavLink to="/import" className={({ isActive }) => 'app-nav-link' + (isActive ? ' app-nav-link--active' : '')}>Import<br />Data</NavLink>
          </div>
          <div className="app-nav-avatar" aria-label="Account">YL</div>
        </div>
      </nav>
      <div className="app-page">
        <Routes>
          <Route path="/" element={<Home />} />
          <Route path="/summary" element={<Summary />} />
          <Route path="/dividends" element={<Dividends portfolios={portfolios} />} />
          <Route path="/portfolios" element={<Portfolios portfolios={portfolios} onPortfoliosChange={loadPortfolios} />} />
          <Route path="/transactions" element={<Transactions portfolios={portfolios} />} />
          <Route path="/import" element={<Import onImported={loadPortfolios} />} />
        </Routes>
      </div>
    </BrowserRouter>
  )
}
