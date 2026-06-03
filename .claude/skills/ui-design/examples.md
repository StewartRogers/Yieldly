# ui-design Examples

Concrete snippets for the most common patterns. Each shows the correct approach; deviations should be flagged in review.

---

## Card (data view)

```jsx
// ✅ Correct: shadcn Card with token-aligned overrides
<Card>
  <CardHeader className="border-b">
    <CardTitle>
      <span className="block text-xs font-semibold uppercase tracking-widest text-muted-foreground mb-1">
        Section label
      </span>
      Section heading
    </CardTitle>
    <CardAction>
      <Button size="sm" onClick={handleAction}>Action</Button>
    </CardAction>
  </CardHeader>
  <CardContent className="p-0">
    {/* table or content goes here */}
  </CardContent>
</Card>

// ❌ Wrong: hardcoded colors, arbitrary spacing
<div style={{ background: '#fff', padding: '20px', borderRadius: '10px' }}>
  ...
</div>
```

---

## Financial table row

```jsx
// ✅ Correct: right-aligned, tabular-nums, positive/negative color classes
<TableRow>
  <TableCell className="font-semibold">{holding.ticker}</TableCell>
  <TableCell className="text-right tabular-nums">{fmtCurrency(holding.buy_total)}</TableCell>
  <TableCell className={`text-right tabular-nums ${holding.return >= 0 ? 'positive' : 'negative'}`}>
    {fmtCurrency(holding.return)}
  </TableCell>
</TableRow>

// ❌ Wrong: left-aligned numbers, inline color
<TableRow>
  <td>{holding.ticker}</td>
  <td>{holding.buy_total}</td>
  <td style={{ color: holding.return >= 0 ? 'green' : 'red' }}>{holding.return}</td>
</TableRow>
```

---

## Button (accessible)

```jsx
// ✅ Correct: shadcn Button with all states via component defaults
<Button onClick={handleSave} disabled={saving}>
  {saving ? 'Saving…' : 'Save'}
</Button>

// ✅ Correct: custom button using style.css classes when shadcn can't support the behavior
// (e.g. draggable portfolio tab — shadcn Tabs doesn't support drag-reorder)
<button
  className={`portfolio-tab${isActive ? ' active' : ''}`}
  draggable
  onDragStart={handleDragStart}
  // comment: custom — shadcn Tabs doesn't support drag-reorder
>
  {portfolio.code}
</button>

// ❌ Wrong: no focus state, hardcoded color
<button style={{ background: '#2563eb', color: 'white' }} onClick={handleSave}>
  Save
</button>
```

---

## Inline-editable cell (read-only → editing)

```jsx
// ✅ Correct: derived/read-only input looks distinct from editable ones
// Read-only (auto-calculated total):
<Input
  className="h-9 bg-muted/60 text-muted-foreground cursor-default"
  value={total}
  readOnly
  tabIndex={-1}
/>

// Editing state triggered by click:
<TableCell
  className="text-right tabular-nums cursor-pointer group/cash"
  onClick={startEdit}
  title="Click to edit"
>
  {fmtCurrency(value)}
  <span className="ml-1 opacity-0 group-hover/cash:opacity-100 text-muted-foreground text-xs">✎</span>
</TableCell>
```

---

## KPI strip

```jsx
// ✅ Correct: 4-up grid, token colors, no decoration.
// Plain <div> tiles derived from Card visual style — not <Card> components, so no shadow-sm is applied.
<div className="grid grid-cols-2 gap-3 px-4 py-4 sm:grid-cols-4">
  {/* pattern: KPI tile derived from Card visual style — no shadow-sm (not a <Card>) */}
  {kpis.map(k => (
    <div key={k.label} className="rounded-xl border border-border bg-card px-4 py-3">
      <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">{k.label}</p>
      <p className="text-2xl font-bold tabular-nums mt-1">{k.value}</p>
      {k.sub && <p className="text-xs text-muted-foreground mt-0.5">{k.sub}</p>}
    </div>
  ))}
</div>
```

---

## Two-column page layout (form + content)

```jsx
// ✅ Correct: grid at page level, collapses to single column on mobile
<div className="grid grid-cols-1 gap-6 lg:grid-cols-[320px_1fr]">
  {/* Left: shaded form panel */}
  <div className="rounded-xl border bg-muted/40 p-5 flex flex-col gap-4 self-start">
    <h2 className="text-base font-semibold">Form title</h2>
    {/* form fields */}
  </div>

  {/* Right: content card */}
  <Card>
    <CardContent className="p-0">
      {/* table or list */}
    </CardContent>
  </Card>
</div>

// ❌ Wrong: fixed pixel layout that doesn't reflow
<div style={{ display: 'flex' }}>
  <div style={{ width: '320px' }}>...</div>
  <div style={{ flex: 1 }}>...</div>
</div>
```

---

## Positive / negative badges (YoY, return)

```jsx
// ✅ Correct: use existing CSS classes from style.css
<span className={pct >= 0 ? 'badge-pos' : 'badge-neg'}>
  {pct >= 0 ? '▲' : '▼'}{Math.abs(pct).toFixed(0)}%
</span>

// ✅ Correct: plain colored text (table cells, return values)
<span className={value >= 0 ? 'positive' : 'negative'}>
  {fmtCurrency(value)}
</span>
```

---

## Dialog, Badge, and Select

```jsx
// Dialog
// ✅ Correct: shadcn Dialog with allowed width and scroll
<Dialog open={open} onOpenChange={setOpen}>
  <DialogContent className="sm:max-w-2xl max-h-[80vh] overflow-y-auto">
    <DialogHeader><DialogTitle>Transactions — {ticker}</DialogTitle></DialogHeader>
    {/* content */}
  </DialogContent>
</Dialog>

// ❌ Wrong: custom fixed overlay bypasses shadcn (no focus trap, no Esc, no backdrop)
<div style={{ position: 'fixed', top: 0, left: 0, width: '100%', height: '100%', background: 'rgba(0,0,0,0.4)' }}>
  <div style={{ background: 'white', margin: '10% auto', width: 600 }}>{/* content */}</div>
</div>

// Badge
// ✅ Correct: <Badge> for type labels; .type class for transaction-type color
<Badge variant="secondary">ETF</Badge>
<span className="type buy">Buy</span>

// ❌ Wrong: Badge used as a clickable control; hardcoded background
<Badge style={{ background: '#2563eb', cursor: 'pointer' }} onClick={handleFilter}>Buy</Badge>

// Select
// ✅ Correct: shadcn Select with width on trigger
<Select value={type} onValueChange={setType}>
  <SelectTrigger className="w-full h-9"><SelectValue /></SelectTrigger>
  <SelectContent>
    <SelectItem value="BUY">Buy</SelectItem>
    <SelectItem value="SELL">Sell</SelectItem>
  </SelectContent>
</Select>

// ❌ Wrong: native <select> loses all token styling and focus states
<select value={type} onChange={e => setType(e.target.value)}>
  <option value="BUY">Buy</option>
</select>
```

---

## Accessible token variant (`-aa`)

When an existing token fails the 4.5:1 contrast threshold, create a `-aa` variant in `style.css` and use it instead.

```css
/* In client/src/style.css :root */
/* --color-warning (#f59e0b) is 2.8:1 on white — fails WCAG AA */
--color-warning-aa: #b45309; /* 4.8:1 on white — accessible variant */
```

```jsx
// ✅ Correct: reference the -aa token; add the accessibility comment
<span style={{ color: 'var(--color-warning-aa)' }}>
  {/* accessibility: --color-warning fails 4.5:1 on white; using --color-warning-aa */}
  ⚠ 2 errors
</span>

// ❌ Wrong: hardcoded hex, no comment, original failing token
<span style={{ color: '#f59e0b' }}>⚠ 2 errors</span>
```

---

## Motion and Animation

```jsx
// ✅ Correct: ≤ 150 ms, motion-safe, only color/opacity/transform
<button className="transition-colors duration-150 motion-safe:hover:opacity-80 focus-visible:outline focus-visible:outline-2 focus-visible:outline-primary">
  Save
</button>

// ✅ Correct: motion-safe guards an opacity fade
<div className="motion-safe:transition-opacity motion-safe:duration-150">
  {content}
</div>

// ❌ Wrong: too slow, animates layout property, no motion-safe guard
<button className="transition-all duration-500 hover:h-12 hover:px-8">
  Save
</button>

// ❌ Wrong: animates max-height for an accordion without motion-safe
<div className={`overflow-hidden transition-[max-height] duration-300 ${open ? 'max-h-96' : 'max-h-0'}`}>
  {children}
</div>
```

---

## Fallback — novel or uncharted pattern

```jsx
// When no skill rule directly covers the component (e.g. a progress ring):
// 1. Pick the nearest analogue (Badge → color/sizing; Card → surface/border)
// 2. Apply its checklist rules
// 3. Add a comment so future reviewers know this was a deliberate derivation

// ✅ Correct
<div
  className="inline-flex items-center justify-center rounded-full border border-border bg-card w-12 h-12 text-sm font-semibold tabular-nums"
  role="progressbar"
  aria-valuenow={pct}
>
  {/* pattern: derived from Badge (sizing/color) — no skill rule covers progress rings */}
  {pct}%
</div>

// ❌ Wrong — no comment, hardcoded color, arbitrary size
<div style={{ width: 48, height: 48, borderRadius: '50%', color: '#16a34a' }}>
  {pct}%
</div>
```

---

## Spacing anti-patterns

```jsx
// ❌ Arbitrary spacing — don't do this
<div style={{ padding: '14px', marginTop: '20px' }}>

// ❌ Out-of-scale Tailwind
<div className="p-[14px] mt-[20px]">

// ✅ Round to nearest allowed value
<div className="p-3 mt-4">   {/* 12px, 16px */}
```
