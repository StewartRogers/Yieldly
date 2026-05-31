# UI Design Skill (shadcn-style fintech system)

## 1. Design System Priority Rules

If rules conflict, follow this order:

1. Color tokens (highest priority)
2. Accessibility requirements
3. Spacing system
4. Typography
5. Layout rules (flex/grid)
6. Shadows and decoration (lowest priority)

If still conflicting, prefer readability over aesthetics.

---

## 2. Color Tokens (DO NOT DEVIATE)

### Base

```css
--bg-page: #f6f7f9;
--bg-surface: #ffffff;
--bg-muted: #f0f2f5;

--text-primary: #0f172a;
--text-secondary: #64748b;
```

### Primary

```css
--color-primary: #2563eb;
--color-primary-hover: #1d4ed8;
--color-primary-active: #1e40af;
```

### Status

```css
--color-success: #16a34a;
--color-warning: #f59e0b;
--color-error: #dc2626;
```

---

## 3. Typography

* Font: Inter, system-ui, sans-serif
* Body: 16px, line-height 1.5
* Numbers: tabular-nums enabled
* Headings: 600 weight only
* No font variations outside scale

---

## 4. Spacing System (STRICT)

Use only:

```text
4px, 8px, 12px, 16px, 24px, 32px, 48px
```

No arbitrary spacing allowed.

Base spacing unit = 8px.

---

## 5. Shadows (STRICT TOKENS)

```css
--shadow-sm: 0 1px 2px rgba(16, 24, 40, 0.04);
--shadow-md: 0 8px 24px rgba(16, 24, 40, 0.06);
```

Default: use only `--shadow-sm`.

---

## 6. Border Rules

* Default border: 1px solid rgba(15, 23, 42, 0.08)
* Radius scale:

  * sm: 6px
  * md: 8px
  * lg: 12px

---

## 7. Breakpoints (MOBILE-FIRST)

```text
--bp-sm: 640px
--bp-md: 768px
--bp-lg: 1024px
```

Rules:

* Base: <640px
* sm: ≥640px
* md: ≥768px
* lg: ≥1024px

---

## 8. Layout Rules

* Use Flexbox for UI alignment
* Use Grid for page structure
* Never mix inconsistent layout methods within a component
* If existing code uses a pattern, match it unless it breaks responsiveness

---

## 9. Accessibility (MANDATORY)

* All text contrast must be ≥ 4.5:1
* Focus state required:

```css
outline: 2px solid var(--color-primary);
outline-offset: 2px;
```

* All interactive elements must be keyboard accessible
* Buttons must have hover, focus, and active states
* Use semantic HTML where possible

---

## 10. shadcn/ui Usage Rules

When building UI:

* Always prefer shadcn/ui components first
* Never recreate these manually:

  * Button
  * Card
  * Table
  * Input
  * Dialog
  * Tabs
  * Badge

If a component exists in shadcn/ui, use it.

Use Tailwind only for:

* spacing
* layout
* minor adjustments

---

## 11. Financial UI Rules

* Numbers must be right-aligned in tables
* Use tabular numbers for all currency
* Positive = green, negative = red
* Avoid decorative visuals
* Dense layouts preferred over spacious marketing layouts

---

## 12. Component Defaults

### Card

* bg: var(--bg-surface)
* border-radius: 12px
* shadow: var(--shadow-sm)
* padding: 16px

### Buttons

* Primary: var(--color-primary)
* Radius: 8px
* Height: 40px minimum

### Tables

* No heavy borders
* Subtle row separators only
* Hover state: var(--bg-muted)

---

## 13. Error Handling Rules

If constraints conflict:

1. Preserve color tokens
2. Preserve accessibility rules
3. Preserve spacing system
4. Degrade shadows or decoration last

If still unresolved:

* Output simplest readable UI
* Document what was dropped

---

## 14. Default Goal

Produce UI that is:

* consistent
* minimal
* finance-grade
* readable under high data density
