# Yieldly — Design Spec · “Terminal Calm”

> **Authoritative.** This is a high-fidelity design. Every value below is final and matches
> `yieldly-terminal.css` (the runnable source of truth). Port these tokens directly into the
> app's styling layer (CSS variables, Tailwind theme, styled-components theme, etc.). Dark
> theme. Reference build: `Yieldly Hi-Fi.html`.

---

## 1. Color

### Surfaces
| Token | Hex | Use |
|---|---|---|
| `--bg` | `#0D1014` | app background |
| `--panel` | `#161A21` | cards, nav, table surface |
| `--panel-2` | `#1C222B` | raised: total rows, active tab, KPI emphasis |
| `--panel-3` | `#11151B` | recessed: modal footer, code blocks, dropzone |
| `--inset` | `#0F1318` | input wells |

### Lines
| Token | Hex | Use |
|---|---|---|
| `--line` | `#262D38` | hairlines, card borders, row dividers |
| `--line-2` | `#323B48` | stronger borders, input borders, total top-rule |

### Text
| Token | Hex | Use |
|---|---|---|
| `--ink` | `#E7EBF1` | primary text, numbers |
| `--ink-2` | `#B7C0CC` | secondary text, body copy on hero |
| `--muted` | `#8B94A1` | labels, captions, inactive nav |
| `--faint` | `#5E6776` | hints, disabled, footnotes |

### Accent (brand mint)
| Token | Hex | Use |
|---|---|---|
| `--accent` | `#6EE7B7` | primary buttons, active states, brand mark, focus |
| `--accent-press` | `#53D8A4` | pressed/hover on primary |
| `--accent-ink` | `#06231B` | text/icon ON an accent fill |
| `--accent-soft` | `rgba(110,231,183,.13)` | active pill bg, kicker bg, focus ring |
| `--accent-line` | `rgba(110,231,183,.35)` | active pill border, focus border |

### Semantic — gain / loss (also use ▲ / ▼ glyphs)
| Token | Hex | Background |
|---|---|---|
| `--gain` | `#4ADE80` | `--gain-bg rgba(74,222,128,.13)` |
| `--loss` | `#F87171` | `--loss-bg rgba(248,113,113,.13)` |

### Semantic — transaction types (also carry a colored dot)
| Type | Token | Hex |
|---|---|---|
| Buy | `--t-buy` | `#4ADE80` |
| Sell | `--t-sell` | `#FBBF24` |
| Dividend | `--t-div` | `#38BDF8` |
| Dividend Reinvest | `--t-reinvest` | `#A78BFA` |
| Contribution | `--t-contrib` | `#2DD4BF` |
| Withdrawal | `--t-withdraw` | `#FB7185` |

Each badge uses the hue for text/border + a ~12% alpha fill of the same hue. Investment-type
badges (Stock / ETF) are neutral (`--panel-2` bg, `--muted` text).

---

## 2. Type

| Role | Family | Size / weight | Notes |
|---|---|---|---|
| Display / headings | **Space Grotesk** | 600 | page titles 26, card titles 16–18, hero 60 |
| Body / UI | **Hanken Grotesk** | 400–600 | base 15, labels 11 uppercase |
| Numbers | **JetBrains Mono** | 400–600 | ALL money/figures, `tabular-nums`, letter-spacing −0.03em |

Type scale (px): hero `60` · page title `26` · card/section title `16–18` · KPI value `26` ·
hero total `56` (mono) · body `15` · table cell `13.5` · label/overline `11` (uppercase,
letter-spacing .08–.16em, `--muted`) · badge `11`.

> Numbers are **always** mono + tabular so columns align to the cent. Currency in Canadian
> locale (`$1,234.56`).

---

## 3. Spacing — 4px base
`4 · 8 · 12 · 16 · 20 · 24 · 32 · 48` (tokens `--s1`…`--s8`).

- Card padding `20`. Card header `16 20`. Table cell `13 18` (header `12 18`).
- Section gap on a page `18–24`. Page container padding `28 24`.
- Default flex/grid gap `10–14`.

---

## 4. Shape & elevation

| Token | Value |
|---|---|
| `--radius` | `12px` (cards, inputs-group, modals body) |
| `--radius-sm` | `8px` (buttons, pills-as-tabs, inputs) |
| `--radius-lg` | `16px` (modal, dropzone, hero chat) |
| `--radius-pill` | `999px` (pills, badges, delta tags) |
| `--shadow` | `0 1px 0 rgba(255,255,255,.02), 0 10px 30px -18px rgba(0,0,0,.7)` |
| `--shadow-lg` | `0 24px 60px -24px rgba(0,0,0,.8)` (modals) |

Borders are `1px` (`--line`) on cards/rows, `1px` (`--line-2`) on interactive controls.

---

## 5. Layout
- Centered container, **max-width `1280px`** (`--maxw`), padding `28px 24px 80px`.
- **Sticky top nav**, height `60px` (`--nav-h`), `--panel` at 85% + 12px backdrop blur,
  bottom `--line`. Brand mark (mint gradient rounded square + wordmark) · nav links · spacer
  · refresh icon-button · avatar.
- Per-page grids:
  - **Home** — centered hero (radial mint glow) + centered assistant column (≤780px).
  - **Summary** — hero number + 3-up KPI + overview table + book-value matrix (stacked).
  - **Dividends** — header + account pills + 4-up KPI + income matrix.
  - **Portfolios** — account-tab row → create form → Card/List segmented toggle → grid
    (`repeat(auto-fill, minmax(280px,1fr))`) or list table.
  - **Transactions** — `320px` form rail + fluid history table (sticky header, 20-row pager).
  - **Import** — 2 equal columns: dropzone+status / format-spec table.

---

## 6. Component anatomy

- **Button** — `.btn` default (outline on `--panel`), `.primary` (mint fill, `--accent-ink`
  text), `.ghost`, `.danger` (loss border on hover), `.sm`, `.block`. Radius `--radius-sm`.
- **Pill** — filter/range chip; active = `--accent-soft` bg + `--accent` text + `--accent-line`
  border.
- **Segmented control** (`.seg`) — Card/List, By month/quarter; active segment = `--panel-2`.
- **KPI** — label (overline) + mono value (26) + delta caption.
- **Card** — `--panel` + `--line` + `--shadow` + `--radius`; optional `.card-head` (display
  title + muted meta) over a divider.
- **Table** — uppercase muted sticky header w/ bottom rule; rows divided by `--line`; first
  col left + display ticker, rest right + mono; hover `--panel-2`; bold **total** row on
  `--panel-2` with `--line-2` top rule.
- **Inline-editable cell** (`.editable`) — `--inset` bg, `--line-2` border, trailing ✎;
  hover → `--accent-line`.
- **Badge** — pill; transaction-type variants colored per §1 with a leading dot; neutral for
  investment type. `NEW` tag = mint, `--accent-soft`.
- **Holding card** — header (display ticker + name / type badge) → 2-col key/value (mono
  values) → divider → total-return line (gain/loss) → two block buttons (Edit / Transactions).
  Dashed “Add holding” card closes the grid.
- **Form field** — uppercase label + `.input` (well). Selects show ▾. **Derived** field
  (auto total) = `--panel-2`, dashed border (reads as output). Focus = `--accent-line` +
  `--accent-soft` ring.
- **Modal** — scrim `rgba(6,8,11,.66)` + blur; panel `--radius-lg` + `--shadow-lg`; head
  (title + ✕) / body / footer (`--panel-3`, actions right). Transactions modal opens with a
  **summary bar** (Net shares · Total cost · Commission · ACB/share) above the rows.
- **Dropzone** — dashed `--line-2`, `--panel-3`; hover → mint. **Status banner** ok/warn use
  gain/loss tints. Errors shown in a mono code block, row-addressed with a suggested fix.
- **Pagination** — mono page buttons; active = `--accent-soft`/`--accent`/`--accent-line`.

---

## 7. Interaction states (in the reference build)
Active nav link · active pill/segment · row hover · button hover/press · input focus ring ·
Card⇄List toggle · single-select account tabs & dividend pills · Edit/Transactions modals
(scrim-click / Esc / ✕ to close). Still to build against real data: inline-edit commit,
async price-refresh + import loading/error, drag-to-reorder persistence, live total calc,
real pagination.

---

## 8. Files
- `yieldly-terminal.css` — the runnable token + component source of truth.
- `Yieldly Hi-Fi.html` — all six pages, interactive.
- `screenshots/` — full-page renders.
