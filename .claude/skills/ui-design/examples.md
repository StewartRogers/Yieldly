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
// ✅ Correct: 4-up grid, token colors, no decoration
<div className="grid grid-cols-2 gap-3 px-4 py-4 sm:grid-cols-4">
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

## Spacing anti-patterns

```jsx
// ❌ Arbitrary spacing — don't do this
<div style={{ padding: '14px', marginTop: '20px' }}>

// ❌ Out-of-scale Tailwind
<div className="p-[14px] mt-[20px]">

// ✅ Round to nearest allowed value
<div className="p-3 mt-4">   {/* 12px, 16px */}
```
