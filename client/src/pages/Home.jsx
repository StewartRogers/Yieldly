import { useNavigate } from 'react-router-dom'
import { Button } from '@/components/ui/button'
import { Card, CardContent } from '@/components/ui/card'

const CHAT_MESSAGES = [
  { role: 'user',      text: 'How did my dividends trend this year vs last?' },
  { role: 'assistant', text: <>Your trailing-12-mo dividend income is up <strong>+14%</strong>. Biggest contributor: <strong>RY</strong> in your RRSP…</> },
  { role: 'user',      text: 'Which holding has the best ACB return?' },
]

const FEATURE_HINTS = [
  { icon: '💬', label: 'Suggested example prompts' },
  { icon: '📊', label: 'Reads your live holdings' },
  { icon: '🔒', label: 'Stays on your device' },
]

export default function Home() {
  const navigate = useNavigate()

  return (
    <div className="flex flex-col gap-8 max-w-2xl mx-auto">
      {/* Hero */}
      <Card>
        <CardContent className="pt-12 pb-12 flex flex-col items-center text-center gap-6">
          <span className="inline-flex items-center rounded-full border border-border px-3 py-1 text-xs font-medium text-muted-foreground">
            Your money, all in one ledger
          </span>
          <h1 className="text-4xl font-bold tracking-tight leading-tight">
            Track every share,<br />dividend &amp; dollar.
          </h1>
          <p className="text-muted-foreground text-lg max-w-sm">
            Live prices, adjusted cost base, and dividend history across all your accounts.
          </p>
          <div className="flex gap-3 flex-wrap justify-center">
            <Button size="lg" onClick={() => navigate('/summary')}>
              View Summary →
            </Button>
            <Button variant="outline" size="lg" onClick={() => navigate('/portfolios')}>
              Open Portfolios
            </Button>
            <Button variant="outline" size="lg" onClick={() => navigate('/import')}>
              Import Data
            </Button>
          </div>
        </CardContent>
      </Card>

      {/* AI Portfolio Assistant */}
      <Card>
        <CardContent className="py-8 flex flex-col gap-6">
          <div className="flex items-center gap-3">
            <h2 className="text-xl font-semibold">AI Portfolio Assistant</h2>
            <span className="inline-flex items-center rounded-full bg-primary/10 px-2.5 py-0.5 text-xs font-semibold text-primary">
              Coming soon
            </span>
          </div>

          {/* Chat preview */}
          <div className="rounded-lg border bg-muted/30 p-5 flex flex-col gap-3">
            {CHAT_MESSAGES.map((msg, i) => (
              <div key={i} className={`chat-message ${msg.role}`}>
                <p>{msg.text}</p>
              </div>
            ))}
            <div className="flex gap-2 mt-2">
              <input
                type="text"
                className="flex-1 rounded-lg border bg-card px-4 py-2 text-sm text-muted-foreground cursor-not-allowed"
                placeholder="Ask about your portfolio…"
                disabled
              />
              <Button disabled size="sm">Send</Button>
            </div>
            <p className="text-xs text-center text-muted-foreground">
              Preview only — assistant is not live yet
            </p>
          </div>

          {/* Feature hints */}
          <div className="grid grid-cols-3 gap-3">
            {FEATURE_HINTS.map(f => (
              <div
                key={f.label}
                className="flex flex-col items-center gap-2 rounded-lg border border-dashed p-4 text-center text-sm text-muted-foreground"
              >
                <span className="text-xl">{f.icon}</span>
                {f.label}
              </div>
            ))}
          </div>
        </CardContent>
      </Card>
    </div>
  )
}
