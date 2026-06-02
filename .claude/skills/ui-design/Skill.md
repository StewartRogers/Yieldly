# UI Design Skill (shadcn-style fintech system)

_Applies to: all pages in `client/src/pages/` and `client/src/components/`._

---

## 1. Conflict Resolution (single source of truth)

When rules in this skill conflict, resolve in this order — highest wins:

1. Color tokens
2. Accessibility requirements
3. Spacing system
4. Typography
5. Layout rules (flex/grid)
6. Shadows and decoration (lowest priority)

If still unresolved, prefer readability over aesthetics and output the simplest readable UI. Note in a code comment what was dropped and why.

---

## 2. Color Tokens

**Do not hardcode values.** The authoritative definitions live in `client/src/style.css` (`:root` block) and `client/src/index.css`. Use CSS custom properties or the Tailwind aliases mapped to them:

| Intent | CSS var | Tailwind alias |
|---|---|---|
| Page background | `--bg-page` | `bg-background` |
| Surface (card) | `--bg-surface` | `bg-card` |
| Muted fill | `--bg-muted` | `bg-muted` |
| Body text | `--text-primary` | `text-foreground` |
| Secondary text | `--text-secondary` | `text-muted-foreground` |
| Primary action | `--color-primary` | `bg-primary` / `text-primary` |
| Success | `--color-success` | — (use `text-[#16a34a]` or add a token) |
| Warning | `--color-warning` | — |
| Error / destructive | `--color-error` | `text-destructive` |
| Border | `--border-color` | `border-border` |

If a new token is needed, add it to `style.css` first — never inline the hex.

---

## 3. Typography

- Font: Inter, system-ui, sans-serif (already applied globally)
- Body: 16 px, line-height 1.5
- Numbers: always `tabular-nums` (Tailwind: `tabular-nums`)
- Headings: `font-semibold` (600) only — no 700+ except hero/landing use
- **Allowed size classes:** `text-xs` · `text-sm` · `text-base` · `text-lg` · `text-xl` · `text-2xl` · `text-4xl`
- No arbitrary `text-[13px]` or similar outside this scale

---

## 4. Spacing System

Use only multiples of 4 px. The mapping to Tailwind classes:

| px | Tailwind |
|---|---|
| 4 | `p-1` / `gap-1` / `m-1` |
| 8 | `p-2` / `gap-2` / `m-2` |
| 12 | `p-3` / `gap-3` / `m-3` |
| 16 | `p-4` / `gap-4` / `m-4` |
| 24 | `p-6` / `gap-6` / `m-6` |
| 32 | `p-8` / `gap-8` / `m-8` |
| 48 | `p-12` / `gap-12` / `m-12` |

**Half-steps** (`p-0.5`, `p-1.5`, `p-2.5`) are permitted inside shadcn component overrides where the component's internal rhythm requires them. Avoid elsewhere.

If a wireframe specifies spacing outside this scale, round to the nearest allowed value.

---

## 5. Shadows

Use only the tokens defined in `style.css`:

```css
--shadow-sm: 0 1px 2px rgba(16, 24, 40, 0.04);   /* default for cards */
--shadow-md: 0 8px 24px rgba(16, 24, 40, 0.06);   /* modals, dropdowns */
```

No `shadow-lg`, `shadow-xl`, or arbitrary box-shadow values.

---

## 6. Border Rules

- Default: `1px solid var(--border-color)` (Tailwind: `border-border`)
- Radius:

| Context | Value | Tailwind |
|---|---|---|
| Small controls (badges, chips) | 6 px | `rounded-md` / `rounded-full` for pills |
| Buttons, inputs, table wrappers | 8 px | `rounded-lg` |
| Cards, modals, sections | 12 px | `rounded-xl` |

---

## 7. Breakpoints (mobile-first)

| Alias | Min-width | Tailwind prefix |
|---|---|---|
| base | < 640 px | (no prefix) |
| sm | ≥ 640 px | `sm:` |
| md | ≥ 768 px | `md:` |
| lg | ≥ 1024 px | `lg:` |

All layouts must reflow cleanly at base (single column, scrollable tables).

---

## 8. Layout Rules

- **Page shell:** CSS Grid (`grid`, `grid-cols-*`) for multi-column page structure
- **Component internals:** Flexbox (`flex`, `flex-col`) for alignment within a component
- "Never mix inconsistent layout methods" means: don't use Grid for alignment _inside_ a component that also uses Flex for the same purpose. Using Grid at page level and Flex inside each card is correct and expected.

---

## 9. Accessibility (mandatory)

- All text contrast ≥ 4.5:1 against its background

**Known safe pairs:**
| Text token | Background | Approx ratio |
|---|---|---|
| `--text-primary` (#0f172a) | white | 19:1 ✅ |
| `--text-secondary` (#64748b) | white | 4.5:1 ✅ (borderline — avoid on small text) |
| `--color-primary` (#2563eb) | white | 4.8:1 ✅ |
| white | `--color-primary` | 4.8:1 ✅ |

- Focus state required on every interactive element:
  ```css
  outline: 2px solid var(--color-primary);
  outline-offset: 2px;
  ```
  Tailwind: `focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary`
- All interactive elements must be keyboard-reachable (no `tabIndex={-1}` on focusable controls except intentional skip targets)
- Use semantic HTML: `<button>` for actions, `<a>` for navigation, `<table>` for tabular data

---

## 10. shadcn/ui Usage Rules

**Always prefer a shadcn component** when one exists for the job:

| Need | Use |
|---|---|
| Action trigger | `<Button>` |
| Data container | `<Card>`, `<CardHeader>`, `<CardContent>` |
| Tabular data | `<Table>`, `<TableHeader>`, `<TableRow>`, `<TableCell>` |
| Text input | `<Input>`, `<Textarea>` |
| Overlay | `<Dialog>`, `<DialogContent>` |
| Navigation tabs | `<Tabs>` |
| Label/pill | `<Badge>` |
| Dropdown | `<Select>`, `<SelectContent>` |

**Allowed Tailwind uses on top of shadcn:**
- Spacing (`p-*`, `gap-*`, `m-*`)
- Layout (`flex`, `grid`, `col-span-*`)
- Typography (`text-sm`, `font-semibold`, `tabular-nums`)
- Color overrides tied to tokens (`text-primary`, `bg-muted`)
- Interactive states (`hover:bg-muted`, `disabled:opacity-50`)
- Width/height constraints (`w-full`, `max-w-lg`, `min-h-[200px]`)

**Fallback when shadcn can't support a behavior** (e.g. draggable tabs, custom dropzones, inline editable cells):
1. Use semantic HTML + CSS classes from `style.css` (e.g. `.portfolio-tab`, `.cash-inline-form`)
2. Keep the visual style aligned with shadcn tokens
3. Add a comment: `{/* custom: shadcn Tabs doesn't support drag-reorder */}`

**Button height:** shadcn `Button` defaults to `h-8` (32 px). The 40 px minimum applies only to hand-rolled `<button>` elements outside shadcn. Do not force `h-10` on shadcn `Button` unless the design explicitly requires it.

---

## 11. Financial UI Rules

**Data-view pages** (Summary, Dividends, Portfolios, Transactions):
- Numbers right-aligned in tables
- `tabular-nums` on all currency and numeric cells
- Positive values: `--color-success` / `.positive` class
- Negative values: `--color-error` / `.negative` class
- Dense layouts preferred — minimize padding, keep rows tight
- Avoid decorative visuals, gradients, or illustration

**Landing / onboarding pages** (Home, Import):
- Spacious center-column layout is acceptable
- Marketing copy and hero sections may use larger type and more padding
- Still use the token system — no hardcoded colors or arbitrary spacing

---

## 12. Component Defaults

### Card
- Background: `bg-card` (`--bg-surface`)
- Border radius: 12 px (`rounded-xl`)
- Border: `border border-border`
- Shadow: `--shadow-sm`
- Padding: 16 px (`p-4`) via `CardContent`; 12 px (`p-3`) for `size="sm"`

### Button (shadcn)
- Primary: `bg-primary text-primary-foreground`
- Radius: `rounded-lg` (8 px — shadcn default)
- Default height: `h-8` (32 px); use `size="lg"` (`h-9`) for hero CTAs

### Table
- No heavy outer borders
- Row separator: `border-b border-border`
- Header: `bg-muted text-muted-foreground text-xs uppercase tracking-wide`
- Row hover: `hover:bg-muted/50`
- Numeric cells: `text-right tabular-nums`

### Input
- Height: `h-9` standard, `h-8` compact, `h-7` inline-edit
- Read-only / derived fields: add `bg-muted/60 text-muted-foreground cursor-default`

---

## 13. Goal

Produce UI that is **consistent, minimal, finance-grade** (meaning: information is primary; decoration does not compete with data), and **readable under high data density**.
