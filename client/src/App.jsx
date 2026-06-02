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

  const navClass = ({ isActive }) => 'nav-link' + (isActive ? ' active' : '')

  return (
    <BrowserRouter>
      <nav className="top-nav">
        <div className="nav-container">
          <div className="nav-brand">
            <img src="/logo.svg" alt="Yieldly" className="nav-logo" />
            <span className="nav-title">Yieldly</span>
          </div>
          <div className="nav-menu">
            <NavLink to="/" end className={navClass}>Home</NavLink>
            <NavLink to="/summary" className={navClass}>Summary</NavLink>
            <NavLink to="/dividends" className={navClass}>Dividends</NavLink>
            <NavLink to="/portfolios" className={navClass}>Portfolios</NavLink>
            <NavLink to="/transactions" className={navClass}>Transactions</NavLink>
            <NavLink to="/import" className={navClass}>Import Data</NavLink>
          </div>
        </div>
      </nav>
      <div className="container">
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
