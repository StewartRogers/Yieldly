import { useNavigate } from 'react-router-dom'
import { LayoutGrid, Lock, Clock } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'

const CHAT_MESSAGES = [
  { role: 'user',      text: 'How did my dividends trend this year vs last?' },
  { role: 'assistant', text: <>Your trailing-12-month dividend income is up <strong className="up">+14%</strong>. Biggest contributor: <strong>RY</strong> in your RRSP, which added <span className="num">$212</span> over last year.</> },
  { role: 'user',      text: 'Which holding has the best return on cost?' },
  { role: 'assistant', text: <><strong>BN</strong> leads at <strong className="up">+91.5%</strong> on adjusted cost base, ahead of VFV at <span className="num up">+35.2%</span>.</> },
]

const FEATURES = [
  { Icon: Clock,      label: 'Suggested example prompts' },
  { Icon: LayoutGrid, label: 'Reads your live holdings' },
  { Icon: Lock,       label: 'Stays on your device' },
]

export default function Home() {
  const navigate = useNavigate()

  return (
    <div>
      {/* ── Hero ── */}
      <div className="home-hero-section">
        <div style={{ position: 'relative', zIndex: 1 }}>
          <span className="kicker">● Your money, all in one ledger</span>
          <h1 className="disp" style={{ fontSize: 52, lineHeight: 1.04, letterSpacing: '-0.035em', fontWeight: 600, maxWidth: '16ch', margin: '18px auto 0', color: 'var(--ink)' }}>
            Track every share, dividend&nbsp;&amp;&nbsp;dollar.
          </h1>
          <p style={{ color: 'var(--ink-2)', fontSize: 17, maxWidth: '54ch', margin: '16px auto 0', lineHeight: 1.55 }}>
            Live prices, adjusted cost base, and full dividend history across all your accounts — RRSP, TFSA, and beyond.
          </p>
          <div className="row" style={{ justifyContent: 'center', marginTop: 28, gap: 12, flexWrap: 'wrap' }}>
            <Button onClick={() => navigate('/summary')}>
              View Summary →
            </Button>
            <Button variant="outline" onClick={() => navigate('/portfolios')}>
              Open Portfolios
            </Button>
            <Button variant="ghost" onClick={() => navigate('/import')}>
              Import Data
            </Button>
          </div>
        </div>
      </div>

      {/* ── AI Assistant ── */}
      <div style={{ maxWidth: 780, margin: '40px auto 0' }}>
        <div className="row" style={{ justifyContent: 'center', marginBottom: 20, gap: 12 }}>
          <h2 className="disp" style={{ fontSize: 28, fontWeight: 600, letterSpacing: '-0.02em', margin: 0, color: 'var(--ink)' }}>
            AI Portfolio Assistant
          </h2>
          <span className="tc-badge" style={{ color: 'var(--tc-accent)', background: 'var(--accent-soft)', borderColor: 'var(--accent-line)' }}>
            <span className="dot" />
            Coming soon
          </span>
        </div>

        {/* Chat preview */}
        <div className="tc-card tc-card-pad">
          <div className="col" style={{ gap: 12 }}>
            {CHAT_MESSAGES.map((msg, i) => (
              <div key={i} className={`bubble ${msg.role === 'user' ? 'me' : 'ai'}`}>
                {msg.text}
              </div>
            ))}
          </div>
          <div className="row" style={{ marginTop: 16, opacity: 0.55, pointerEvents: 'none' }}>
            <Input placeholder="Ask about your portfolio…" style={{ flex: 1 }} disabled />
            <Button disabled size="sm">Send</Button>
          </div>
          <p className="note" style={{ justifyContent: 'center', marginTop: 10 }}>
            Preview only — the assistant is not live yet
          </p>
        </div>

        {/* Feature hints */}
        <div className="feature-row" style={{ marginTop: 26 }}>
          {FEATURES.map(({ Icon, label }) => (
            <div key={label} className="f">
              <span className="fi"><Icon size={14} /></span>
              {label}
            </div>
          ))}
        </div>
      </div>
    </div>
  )
}
