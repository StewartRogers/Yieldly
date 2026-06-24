import { useState } from 'react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'

export default function Login({ needsSetup, onAuthenticated }) {
  const [username, setUsername] = useState('')
  const [password, setPassword] = useState('')
  const [confirmPassword, setConfirmPassword] = useState('')
  const [error, setError] = useState('')
  const [loading, setLoading] = useState(false)

  const handleSubmit = async (e) => {
    e.preventDefault()
    setError('')

    if (needsSetup && password !== confirmPassword) {
      setError('Passwords do not match')
      return
    }

    setLoading(true)
    try {
      await onAuthenticated(username, password)
    } catch (err) {
      setError(err.message)
    } finally {
      setLoading(false)
    }
  }

  return (
    <div className="login-page">
      <form className="login-card" onSubmit={handleSubmit}>
        <div className="login-brand">
          <span className="app-nav-mark" aria-hidden="true">Y</span>
          <span className="login-title">Yieldly</span>
        </div>

        <p className="login-subtitle">
          {needsSetup ? 'Create your account to get started.' : 'Sign in to your portfolio.'}
        </p>

        {error && <div className="login-error">{error}</div>}

        <label className="login-label">
          Username
          <Input
            type="text"
            value={username}
            onChange={(e) => setUsername(e.target.value)}
            autoComplete="username"
            autoFocus
            required
          />
        </label>

        <label className="login-label">
          Password
          <Input
            type="password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            autoComplete={needsSetup ? 'new-password' : 'current-password'}
            minLength={needsSetup ? 8 : undefined}
            required
          />
        </label>

        {needsSetup && (
          <label className="login-label">
            Confirm password
            <Input
              type="password"
              value={confirmPassword}
              onChange={(e) => setConfirmPassword(e.target.value)}
              autoComplete="new-password"
              minLength={8}
              required
            />
          </label>
        )}

        {needsSetup && (
          <p className="login-hint">Password must be at least 8 characters.</p>
        )}

        <Button type="submit" disabled={loading} className="login-btn">
          {loading ? (needsSetup ? 'Creating account...' : 'Signing in...') : (needsSetup ? 'Create Account' : 'Sign In')}
        </Button>
      </form>
    </div>
  )
}
