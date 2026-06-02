# Claude Skills

Project-specific slash commands that extend Claude's behaviour for this codebase.

## Available skills

| Skill | Invoke with | Purpose |
|---|---|---|
| `ui-design` | `/ui-design <description>` | Apply the Yieldly fintech design system to a component or page |
| `skill-review` | `/skill-review <skill-name>` | Review a skill file for quality issues and recommend improvements |

## Structure

Each skill lives in its own directory:

```
.claude/skills/
  <skill-name>/
    SKILL.md      ← main instruction file (required)
    examples.md   ← ✅/❌ code samples (recommended)
```

## Adding a skill

1. Create `.claude/skills/<skill-name>/SKILL.md` with the instruction text.
2. Add a row to the table above.
3. Optionally add `examples.md` with concrete ✅/❌ snippets.
4. Run `/skill-review <skill-name>` to check for ambiguity, conflicts, and missing coverage before using it.
