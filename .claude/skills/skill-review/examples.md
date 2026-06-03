# Skill Review — Example Output

This shows what a complete skill review looks like. The skill being reviewed is a toy example (`data-formatter`) with deliberate flaws introduced so you can see every finding type.

---

## Input (toy flawed skill — `data-formatter/SKILL.md`)

```markdown
# Data Formatter Skill

Format data for display.

Rules:
- Format currency as $X,XXX.XX
- Numbers should look nice
- Use the project style
- See §4 for error handling
```

---

## Expected output

---
**Finding 1 — Ambiguity**
**Severity:** error
**What:** "Numbers should look nice" has no measurable definition; different engineers will produce different output (decimal places, thousand separators, rounding).
**Why it matters:** Inconsistent number formatting across the UI, especially mismatched decimal places in financial columns.
**Fix:** Replace with: "Format all numeric values with `toLocaleString('en-CA', { minimumFractionDigits: 2, maximumFractionDigits: 2 })`. Use `tabular-nums` CSS class on all numeric cells."

---
**Finding 2 — Ambiguity**
**Severity:** warning
**What:** "Use the project style" is undefined — no pointer to which file or section defines project style.
**Why it matters:** A model will invent its own interpretation; two models will produce different output.
**Fix:** Replace with a direct reference: "Follow the token and spacing rules in `ui-design/Skill.md`."

---
**Finding 3 — Conflicting constraints**
**Severity:** error
**What:** "See §4 for error handling" references a section that does not exist in the skill file.
**Why it matters:** A model following the cross-reference will fail to find it, then either invent error handling or skip it.
**Fix:** Either add a §4 Error Handling section, or replace the reference with the actual error handling rule inline. Remove section-number cross-references — use section title anchors instead.

---
**Finding 4 — Missing examples**
**Severity:** warning
**What:** No ✅/❌ example for currency formatting. The rule "Format currency as $X,XXX.XX" is clear in principle but leaves open questions: what happens with negative values? Zero? Null?
**Why it matters:** Edge cases (negative returns, zero balance) will be handled inconsistently.
**Fix:** Add an examples.md with: `fmtCurrency(-1234.5) → "-$1,234.50"`, `fmtCurrency(0) → "$0.00"`, `fmtCurrency(null) → "—"`.

---
**Finding 5 — Missing fallback behavior**
**Severity:** warning
**What:** No rule for what to display when the input value is null, undefined, or NaN.
**Why it matters:** Null values will render as "null", "NaN", or throw a runtime error depending on how the model implements the formatter.
**Fix:** Add: "If the value is null, undefined, or NaN, display an em-dash (`—`). Never display the string 'null' or 'NaN'."

---
**Finding 6 — Maintainability**
**Severity:** info
**What:** "See §4 for error handling" uses a hard-coded section number. If a new section is inserted before §4, the reference becomes wrong silently.
**Why it matters:** Stale cross-references mislead the model and require manual audit after every edit.
**Fix:** Use the section title instead: "See the Error Handling section below."

---

| # | Criterion | Location | Severity |
|---|---|---|---|
| 1 | Ambiguity | SKILL.md — "Numbers should look nice" | error |
| 2 | Ambiguity | SKILL.md — "Use the project style" | warning |
| 3 | Conflicting constraints | SKILL.md — "See §4" (missing section) | error |
| 4 | Missing examples | No examples.md exists | warning |
| 5 | Missing fallback behavior | SKILL.md — null/NaN inputs | warning |
| 6 | Maintainability | SKILL.md — section number cross-reference | info |
