# Frontend Skills

AI coding skills for MagicDoor frontend development. This repository contains specialized knowledge modules that help AI coding agents provide better assistance when working with specific frontend technologies, frameworks, and workflows.

## What is This?

This is a skill library for AI coding assistants (like Claude, GitHub Copilot, etc.) that work on the MagicDoor frontend codebase. Each skill is a structured documentation module containing:

- **Best practices** for specific technologies
- **Code patterns** and examples
- **Decision trees** for choosing the right approach
- **Anti-patterns** to avoid
- **Common pitfalls** and how to solve them

## Available Skills

### Frameworks & Libraries

| Skill                                         | Description                       | Triggers                                           |
| --------------------------------------------- | --------------------------------- | -------------------------------------------------- |
| [working-with-solid-use-case](./working-with-solid-use-case/SKILL.md) | SolidJS use-case architecture     | `@magicdoor/solid-use-case`, gateway, use case, presenter, AppState |

### Tools & Workflows

| Skill                                                                     | Description                                 | Triggers                                                         |
| ------------------------------------------------------------------------- | ------------------------------------------- | ---------------------------------------------------------------- |
| [magicdoor-backend-specs](./magicdoor-backend-specs/SKILL.md)             | Backend API integration                     | OpenAPI specs, API types, portal/pay/auth services               |
| [magicdoor-pr-regression-handoff](./magicdoor-pr-regression-handoff/SKILL.md) | PR creation with regression testing         | "create PR", "update PR", "regression doc", "PR描述"             |
| [magicdoor-pr-uat-cases](./magicdoor-pr-uat-cases/SKILL.md)               | Generate UAT cases from PR diff             | "write UAT cases", "generate test cases from diff", preparing QA handoff |
| [resolving-rebase-conflicts](./resolving-rebase-conflicts/SKILL.md)       | Rebase conflict resolution                  | "rebase", "conflicts", "origin/master", resolving merge conflicts during rebase |
| [magicdoor-knowledge-docs-structure](./magicdoor-knowledge-docs-structure/SKILL.md) | Project documentation structure             | `.knowledge/` structure, migrating from `.cursor/docs/`          |
| [rush-monorepo](./rush-monorepo/SKILL.md)                               | Rush monorepo workflow                      | `rush add`, `rush update`, change files, build/test workflows    |
| [magicdoor-backend-use](./magicdoor-backend-use/SKILL.md)             | Direct backend API behavior verification    | Backend spec assumptions, field-level tests, upload session verification |
| [magicdoor-backend-issuer](./magicdoor-backend-issuer/SKILL.md)       | Autonomous backend bug investigation & issue filing | Invoke this skill to automatically file a backend issue from conversation context |
| [work-summary](./work-summary/SKILL.md)                                 | Work report generation                      | Git commits, PRs, personal work summaries                        |

### Development

| Skill                                                                   | Description                     | Triggers                                                 |
| ----------------------------------------------------------------------- | ------------------------------- | -------------------------------------------------------- |
| [ai-taught-me](./ai-taught-me/SKILL.md) (in ~/.claude/skills/)          | Read/write AI-taught-me knowledge repo | "save documentation", "write reports", "记下来", "查一下", "帮我找" |

## How to Use

### For AI Coding Agents

When working in the MagicDoor frontend codebase:

1. **Identify the technology** being used (check imports, file extensions, config files)
2. **Match keywords** to skill triggers (e.g., seeing `createSignal` -> use [solidjs](./solidjs/SKILL.md))
3. **Load the skill** to get contextual guidance
4. **Follow the patterns** and conventions described

Example workflow:

```
User: "Create a SolidJS component for user profiles"
Agent: [Loads solidjs skill]
      -> Uses signal-based reactivity
      -> Follows component patterns
      -> Implements proper TypeScript types
```

### For Human Developers

**Browsing skills:** Each skill is self-contained in its directory with a `SKILL.md` file. Read them to understand:

- How AI agents approach specific technologies
- Coding standards and conventions
- Available helper patterns

**Using AI assistants:** Reference specific skills when prompting:

```
"Use the typescript-expert skill to help me set up
strict TypeScript checks in my monorepo"
```

**Contributing:** See [Contributing](#contributing) below to add new skills.

## Skill Structure

```
skill-name/
├── SKILL.md              # Main skill definition (required)
├── references/           # Optional supplementary docs
│   ├── patterns.md
│   └── api-reference.md
└── scripts/              # Optional utility scripts
    └── helper.py
```

### SKILL.md Format

```yaml
---
name: skill-name
description: |
  When to use this skill. Include specific triggers
category: framework
date_added: "2026-03-21"
---
# Skill Title

Content...
```

## Contributing

### Adding a New Skill

1. **Create directory:** `mkdir new-skill-name`
2. **Write SKILL.md** with proper frontmatter
3. **Add references/** if the skill needs large documentation
4. **Update this README** to list the new skill

See [AGENTS.md](./AGENTS.md) for detailed guidelines on skill format, code style, and validation.

### Skill Content Guidelines

- Focus on ONE primary responsibility per skill
- Use clear, actionable language
- Include complete, runnable code examples
- Cross-reference related skills
- Test code examples before committing

## Repository Maintenance

- **Updates:** Keep skills current with framework versions
- **Deprecation:** Mark obsolete patterns with `**DEPRECATED**`
- **Archiving:** Move obsolete skills to `archive/` rather than deleting

## Related Resources

- [AGENTS.md](./AGENTS.md) - Detailed agent guidelines and workflows
- [MagicDoor Frontend](https://github.com/MagicDoorInc) - Main frontend repository
- [SolidJS Documentation](https://docs.solidjs.com/) - Official SolidJS docs

## License

Skills in this repository are for internal MagicDoor use unless otherwise specified.
