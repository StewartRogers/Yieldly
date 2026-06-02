# Skill Review

Review a Claude skill for quality issues and recommend concrete improvements.

## Scope

- If `$ARGUMENTS` names a skill (e.g. `ui-design`), read all `.md` files in `.claude/skills/$ARGUMENTS/` and review them.
- If `$ARGUMENTS` is empty, review every skill directory found under `.claude/skills/`.
- If the named skill does not exist, say so and list the skill directories that do exist.

## What to review

Check each skill file against these six criteria:

1. **Ambiguity** — Instructions that a model could reasonably interpret in more than one way
2. **Conflicting constraints** — Two or more rules that cannot both be satisfied simultaneously
3. **Missing examples** — Rules or patterns that lack a concrete ✅/❌ code or output sample
4. **Missing fallback behavior** — Cases (empty input, unknown argument, no-issue outcome) with no stated behavior
5. **Excessive complexity** — Rule count or nesting depth that makes the skill hard to apply in a single pass
6. **Maintainability** — Brittle elements: hard-coded cross-references, stale filenames, empty placeholder files, duplicated information that will drift

## Criterion definitions

**Ambiguity:** A rule is ambiguous if replacing one key word with a reasonable synonym changes what gets implemented. Test: could two competent engineers read the rule and produce different code? If yes, flag it.

**Conflicting constraints:** A constraint conflicts if obeying it forces violation of another stated rule. Quote the exact text of both sides.

**Missing examples:** Required for every distinct rule type, every fallback path, and every output format. Optional for self-evident boolean rules (e.g. "use `<button>` not `<div>` for actions").

**Missing fallback behavior:** Flag when the skill describes the happy path but not what happens when: (a) input is empty or malformed, (b) the request matches no rule, (c) the outcome has no issues to report.

**Excessive complexity:** Flag when a skill has more than ~15 actionable rules, uses more than two levels of nesting, or requires holding more than ~5 constraints in working memory to complete a single task.

**Maintainability:** Flag: hard-coded section-number cross-references that will rot (e.g. "see §9"), stale filenames, placeholder files with no content, information duplicated in two places that will drift apart.

## Output format

For each finding, output a block in exactly this structure:

---
**Finding N — \<criterion\>**
**Severity:** error | warning | info
**What:** One sentence naming the specific problem and where it appears (quote the offending text if short).
**Why it matters:** One sentence on what goes wrong if left unfixed.
**Fix:** Concrete, copy-pasteable replacement text or a specific action (delete file X, add section Y, change wording Z to W).

---

After all findings, output a summary table:

| # | Criterion | File | Severity |
|---|---|---|---|
| 1 | Ambiguity | Skill.md:L12 | warning |

**If no issues are found:**

> ## Review complete — no issues found
> Checked: \<list of files reviewed\>. All criteria passed.

## Notes

- Review all `.md` files in the skill directory, not just the primary skill file. `examples.md` is part of the skill.
- Do not suggest adding more rules as a fix unless the skill genuinely lacks coverage. Prefer making existing rules clearer over adding new ones.
- Severity guide: **error** = likely produces broken or inaccessible output; **warning** = inconsistent or unpredictable output; **info** = maintainability or clarity debt.
