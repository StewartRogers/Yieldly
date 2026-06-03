# UI Design Skill (shadcn-style fintech system)

_Applies to: all pages in `client/src/pages/` and `client/src/components/`._
_For ✅/❌ code samples of every pattern below, see `examples.md` in this directory._

---

## Quick Reference

| Most-needed rule | Section |
|---|---|
| Never hardcode colors — use tokens from `style.css` | Color Tokens |
| All text contrast ≥ 4.5:1; `text-muted-foreground` forbidden on `text-sm`/`text-xs` | Accessibility |
| Spacing: multiples of 4 px only — use the table | Spacing System |
| Prefer shadcn; hand-roll only when shadcn can't support the behavior | shadcn/ui Usage |
| Data pages: dense + right-aligned numbers; landing pages: spacious OK | Financial UI Rules |

---

## Hard Constraints (non-overridable)

These two rules cannot be overridden by any other rule in this skill:

- **Accessibility** — All text contrast ≥ 4.5:1. If an existing token produces insufficient contrast, follow the resolution procedure in the Accessibility section. Do not use the token as-is.
- **No hardcoded values** — Never inline hex colors or raw px values. All colors must come from `style.css` tokens; all spacing must use the allowed Tailwind classes in the Spacing System section.

---

## Conflict Resolution (non-accessibility, non-token rules)

When rules in the remaining sections conflict, resolve in this order — highest wins:

1. Spacing system
2. Typography
3. Layout rules (flex/grid)
4. Shadows and decoration (lowest priority)

If still unresolved: prefer the option that meets measurable legibility thresholds (contrast ≥ 4.5:1, font-size ≥ 14 px for body text). Add a code comment in this exact format:

```jsx
/* decision: removed <property> because <reason>; fallback: <token> */
```

**Fallback for patterns not covered by this skill** (novel UI, custom charts, uncharted component types): derive the design from the nearest analogous pattern (e.g. treat a progress ring like a Badge for color and sizing). Add a comment:

```jsx
/* pattern: derived from Badge — no skill rule covers this */
```

If no analogue is identifiable, use `bg-card`, `border-border`, `rounded-xl`, `text-foreground` as a neutral base and add:

```jsx
/* pattern: no analogue found — generic card base applied */
```

---

## Color Tokens

The authoritative definitions live in `client/src/style.css` (`:root` block) and `client/src/index.css`. Use CSS custom properties or the Tailwind aliases mapped to them:

| Intent | CSS var | Tailwind alias | Example use |
|---|---|---|---|
| Page background | `--bg-page` | `bg-background` | `<body>`, page wrapper |
| Surface (card) | `--bg-surface` | `bg-card` | Card, modal, panel |
| Muted fill | `--bg-muted` | `bg-muted` | Table header, shaded panel |
| Body text | `--text-primary` | `text-foreground` | Headings, data cells |
| Secondary text | `--text-secondary` | `text-muted-foreground` | Labels, captions (not on `text-sm`/`text-xs`) |
| Primary background | `--color-primary` | `bg-primary` | Button fill, active tab background |
| Text on primary bg | — | `text-primary-foreground` | Button label, text on filled primary element |
| Primary-colored text | `--color-primary` | `text-primary` | Links, active nav, ticker symbols |
| Success | `--color-success` | Use `.positive` class from `style.css` | Positive return values |
| Warning | `--color-warning` | — | Use `.badge-pos` or add a token (see the Tailwind mapping gap paragraph in this section) |
| Error / destructive | `--color-error` | `text-destructive` | Negative returns, delete actions |
| Border | `--border-color` | `border-border` | All borders |

**Tailwind mapping gap:** `--color-success` and `--color-warning` have no Tailwind alias. Use the `.positive` / `.negative` / `.badge-pos` / `.badge-neg` CSS classes from `style.css`. If a component cannot use CSS classes, add the token to `style.css` and reference it with `text-[color:var(--color-success-tw)]` (the `color:` modifier is required for Tailwind to treat it as a color value — verify it compiles before committing).

**When a token is undefined at runtime:** substitute the nearest existing token (`--bg-surface` for surfaces, `--text-primary` for text, `--border-color` for borders) and add:
```jsx
/* TODO: add <token> to style.css; using fallback */
```

**Adding a new token:** add it to `style.css` first — never inline the hex anywhere else.

---

## Typography

- Font: Inter, system-ui, sans-serif (applied globally — no override needed)
- Body: 16 px, line-height 1.5
- Numbers: always `tabular-nums`
- Headings: `font-semibold` (600) only — `font-bold` (700) permitted on hero/landing headlines only
- **Allowed size classes:** `text-xs` · `text-sm` · `text-base` · `text-lg` · `text-xl` · `text-2xl` · `text-4xl`
- Forbidden: arbitrary sizes (`text-[13px]`, `text-[1.1rem]`, etc.)

---

## Spacing System

Use only multiples of 4 px. Tailwind class mapping:

| px | Tailwind |
|---|---|
| 4 | `p-1` / `gap-1` / `m-1` |
| 8 | `p-2` / `gap-2` / `m-2` |
| 12 | `p-3` / `gap-3` / `m-3` |
| 16 | `p-4` / `gap-4` / `m-4` |
| 24 | `p-6` / `gap-6` / `m-6` |
| 32 | `p-8` / `gap-8` / `m-8` |
| 48 | `p-12` / `gap-12` / `m-12` |

**Half-steps** (`p-0.5`, `p-1.5`, `p-2.5`) are permitted only when passed as `className` directly to a shadcn primitive to compensate for the component's internal padding — for example `<Button className="px-2.5">`. Do not use them on wrapper `<div>` or layout elements.

If a wireframe specifies spacing outside this scale, round to the nearest allowed value. When exactly midway (e.g. 20 px between 16 px and 24 px), round down on data-view pages to preserve density; round up on landing pages.

---

## Shadows

Use only the tokens defined in `style.css`:

```css
--shadow-sm: 0 1px 2px rgba(16, 24, 40, 0.04);   /* default for cards */
--shadow-md: 0 8px 24px rgba(16, 24, 40, 0.06);   /* modals, dropdowns */
```

Forbidden: `shadow-lg`, `shadow-xl`, arbitrary `box-shadow` values.

---

## Border Rules

- Default: `1px solid var(--border-color)` → Tailwind `border-border`
- Radius by context:

| Context | px | Tailwind |
|---|---|---|
| Small controls (badges, chips, pills) | 6 px | `rounded-md` / `rounded-full` |
| Buttons, inputs, table wrappers | 8 px | `rounded-lg` |
| Cards, modals, sections | 12 px | `rounded-xl` |

---

## Breakpoints (mobile-first)

| Alias | Min-width | Tailwind prefix |
|---|---|---|
| base | < 640 px | (no prefix) |
| sm | ≥ 640 px | `sm:` |
| md | ≥ 768 px | `md:` |
| lg | ≥ 1024 px | `lg:` |

All layouts must reflow to a single column at base width. Tables must be horizontally scrollable, not clipped.

---

## Accessibility

_Hard constraint — see the Hard Constraints section above._

**Contrast rule:** All text ≥ 4.5:1 against its background.

**Known safe pairs:**

| Text token | Background | Ratio |
|---|---|---|
| `--text-primary` (#0f172a) | white | 19:1 ✅ |
| `--text-secondary` (#64748b) | white | 4.5:1 ✅ — forbidden on `text-sm` / `text-xs` (≤ 14 px) |
| `--color-primary` (#2563eb) | white | 4.8:1 ✅ |
| white | `--color-primary` | 4.8:1 ✅ |

**"Small text" definition:** `text-sm` (14 px) and `text-xs` (12 px). Do not use `--text-secondary` / `text-muted-foreground` on small text; use `--text-primary` / `text-foreground` instead.

**When a token fails contrast:** create a new token named `--<original-token>-aa` with an accessible value, add it to `style.css`, and use that token everywhere the original fails. Add a code comment:
```jsx
/* accessibility: --color-warning fails 4.5:1 on white; using --color-warning-aa */
```

**Focus state** — required on every interactive element:
```css
outline: 2px solid var(--color-primary);
outline-offset: 2px;
```
Tailwind: `focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary`

**Keyboard access:** all interactive elements must be reachable by Tab. `tabIndex={-1}` is allowed only on intentional skip targets (e.g. the read-only derived Total field in forms).

**Semantic HTML:** `<button>` for actions, `<a>` for navigation, `<table>` for tabular data.

---

## Layout Rules

- **Page shell:** CSS Grid (`grid`, `grid-cols-*`) for multi-column page structure
- **Component internals:** Flexbox (`flex`, `flex-col`) for alignment within a component

**Rule:** Do not apply both `grid` and `flex` to the same container element to solve the same alignment problem.
- ✅ Allowed: Grid on the page wrapper + Flex inside each card
- ❌ Forbidden: `className="grid flex ..."` on a single `<div>` for the same layout purpose

---

## Motion and Animation

- Transitions: ≤ 150 ms, limited to color/opacity/transform on interactive affordances (hover states, focus rings, toggles)
- Do not animate layout-shifting properties (`width`, `height`, `padding`, `max-height` for accordions, `grid-template-*`)
- Respect `prefers-reduced-motion`: wrap non-essential animations in the `motion-safe:` Tailwind prefix or `@media (prefers-reduced-motion: no-preference)`

---

## shadcn/ui Usage

**Prefer shadcn** when a component exists for the job:

| Need | Component |
|---|---|
| Action trigger | `<Button>` |
| Data container | `<Card>`, `<CardHeader>`, `<CardContent>` |
| Tabular data | `<Table>`, `<TableHeader>`, `<TableRow>`, `<TableCell>` |
| Text input | `<Input>`, `<Textarea>` |
| Overlay | `<Dialog>`, `<DialogContent>` |
| Navigation tabs | `<Tabs>` |
| Label / pill | `<Badge>` |
| Dropdown | `<Select>`, `<SelectContent>` |

**Allowed Tailwind overrides on top of shadcn:**
- Spacing (`p-*`, `gap-*`, `m-*`)
- Layout (`flex`, `grid`, `col-span-*`)
- Typography (`text-sm`, `font-semibold`, `tabular-nums`)
- Color classes that map directly to a CSS variable in `style.css` (`text-primary`, `bg-muted`, `text-muted-foreground`)
- Interactive states (`hover:bg-muted`, `disabled:opacity-50`)
- Size constraints (`w-full`, `max-w-lg`, `min-h-[200px]`)

**Fallback when shadcn cannot support the behavior** (e.g. draggable tabs, dropzones, inline-editable cells):
1. Use semantic HTML + CSS classes from `style.css` (e.g. `.portfolio-tab`, `.cash-inline-form`)
2. Keep visual style aligned with shadcn tokens
3. Add a comment: `{/* custom: shadcn <Component> doesn't support <reason> */}`

**Button height:** shadcn `Button` defaults to `h-8` (32 px). Do not force `h-10` unless the design explicitly requires it. The 40 px guideline applies only to hand-rolled `<button>` elements outside shadcn.

---

## Component Checklists

> **Reading these checklists:** "**Must use**" means this class or behaviour must be present in the final output. For shadcn components that apply defaults automatically, "must use" means do not override the default — not that you need to add the class explicitly.

### Card
| Rule | Value |
|---|---|
| **Must use** | `bg-card`, `rounded-xl`, `border-border`; `<Card>` applies `--shadow-sm` automatically via `style.css` — do not override or remove it |
| **Allowed** | `border-b` on `CardHeader`, `p-0` on `CardContent` for flush tables |
| **Forbidden** | Custom `border-radius`, `box-shadow` outside the two shadow tokens |

### Button (shadcn)
| Rule | Value |
|---|---|
| **Must use** | `bg-primary text-primary-foreground` (default); `text-primary-foreground` always on filled primary elements |
| **Allowed** | `size="sm"` (`h-7`), `size="lg"` (`h-9`) for hero CTAs, `variant="outline"` / `"ghost"` |
| **Forbidden** | `text-primary` as button label (that's for links/active text), hardcoded background, `h-10` unless explicitly required |

### Table
| Rule | Value |
|---|---|
| **Must use** | `border-b border-border` on rows; `bg-muted text-muted-foreground text-xs uppercase tracking-wide` on header |
| **Allowed** | `hover:bg-muted/50` on rows, `sticky left-0` on first cell for frozen columns |
| **Forbidden** | Heavy outer borders, left-aligned numeric cells |

### Input
| Rule | Value |
|---|---|
| **Must use** | `h-9` standard; `h-7` inline-edit |
| **Allowed** | `h-8` compact variant |
| **Forbidden** | Arbitrary height; for read-only/derived fields: must add `bg-muted/60 text-muted-foreground cursor-default` and the `readOnly` attribute |

### Dialog
| Rule | Value |
|---|---|
| **Must use** | `<Dialog>` + `<DialogContent>` from shadcn; `rounded-xl`; `--shadow-md` |
| **Allowed** | `sm:max-w-md` / `sm:max-w-2xl` for width; `max-h-[80vh] overflow-y-auto` for tall content |
| **Forbidden** | Custom `position:fixed` overlay (use shadcn Dialog); layout-shifting animations (animating `width`, `height`, `padding`, or `max-height`) |

### Badge
| Rule | Value |
|---|---|
| **Must use** | `<Badge>` for type labels and pills; `variant="secondary"` for neutral tags |
| **Allowed** | `text-xs`, `rounded-full` for pill style; `.type` CSS class from `style.css` for transaction-type color |
| **Forbidden** | Hardcoded background color; using Badge for interactive controls (use Button instead) |

### Select
| Rule | Value |
|---|---|
| **Must use** | `<Select>` + `<SelectTrigger>` + `<SelectContent>` + `<SelectItem>` from shadcn |
| **Allowed** | `className` on `SelectTrigger` for width (`w-full`, `w-36`) |
| **Forbidden** | Native `<select>` element (loses token styling), arbitrary `z-index` on the dropdown |

---

## Financial UI Rules

**Data-view pages** (Summary, Dividends, Portfolios, Transactions):
- Numbers right-aligned; `tabular-nums` on all currency and numeric cells
- Positive values: `.positive` class; Negative values: `.negative` class
- Dense layout preferred. **Decorative padding** means padding added solely for visual breathing room that isn't needed for legibility or alignment — test: if removing it doesn't break alignment or readability, it's decorative. Replace decorative padding with `gap-*` between elements.
- No gradients, illustration, or decorative animation

**Landing / onboarding pages** (Home, Import):
- Spacious center-column layout acceptable
- Hero sections may use `text-4xl` and `p-12`
- Token and spacing systems still apply — no hardcoded values

---

## Goal

Produce UI that is **consistent, minimal, and finance-grade**: information is primary; decoration does not compete with data; layout is readable under high data density.
