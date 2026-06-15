# Contributing to prometheus-governance

Thank you for helping make this better. This guide covers everything you need to go from idea to merged PR.

---

## Table of contents

- [Development setup](#development-setup)
- [Running tests](#running-tests)
- [Project structure](#project-structure)
- [Adding a new rule](#adding-a-new-rule)
- [Adding a built-in agent or skill](#adding-a-built-in-agent-or-skill)
- [Commit conventions](#commit-conventions)
- [Pull request process](#pull-request-process)
- [Reporting bugs](#reporting-bugs)

---

## Development setup

```bash
git clone https://github.com/TenticleTim/prometheus-helper.git
cd prometheus-helper/prometheus
npm install
```

All source code lives in `prometheus/`. The root of the repository is a monorepo shell — the publishable package is entirely self-contained inside `prometheus/`.

### Available scripts

| Command | What it does |
|---------|-------------|
| `npm test` | Run all tests once |
| `npm run test:watch` | Run tests in watch mode |
| `npm run test:coverage` | Run tests with V8 coverage report |
| `npm run typecheck` | TypeScript type-check (no emit) |
| `npm run build` | Build `dist/` via tsup |
| `npm run prometheus:scan` | Run the CLI scan command against this repo |
| `npm run prometheus:doctor` | Run the CLI doctor command against this repo |

---

## Running tests

```bash
cd prometheus

# All tests
npm test

# Watch mode (re-runs on file save)
npm run test:watch

# Coverage report (opens coverage/index.html)
npm run test:coverage
```

Tests use [Vitest](https://vitest.dev/) with a Node environment. Pure-function tests never touch disk. I/O tests write to temporary directories and clean up after themselves.

**Coverage thresholds** are enforced in CI: 70% lines/functions/statements, 65% branches. Do not lower them.

---

## Project structure

```
prometheus/
├── bin/
│   ├── cli.ts              # CLI dispatcher — maps commands to handlers
│   ├── commands/           # One file per CLI command
│   └── lib/                # CLI utilities (arg parser, git helpers)
├── rules/
│   ├── registry.ts         # PROMETHEUS_RULES — single source of truth
│   ├── security.ts         # Security rules
│   ├── typescript.ts       # TypeScript rules
│   ├── react.ts            # React rules
│   ├── nextjs.ts           # Next.js rules
│   ├── ai.ts               # AI/LLM rules
│   ├── performance.ts      # Performance rules
│   ├── database.ts         # Database rules
│   └── quality.ts          # Code quality rules
├── scanner/                # Repo analysis engine
├── catalog/                # Built-in agents, skills, profiles
├── *.ts                    # Core modules (review, severity, doctor, etc.)
└── *.test.ts               # Tests alongside source files
```

**Key invariant:** `rules/registry.ts` is the single source of truth. Every adapter, doctor check, and CI gate derives from it. Never hardcode rule lists anywhere else.

---

## Adding a new rule

1. **Decide the category.** Pick an existing file in `rules/` (e.g. `security.ts`) or create a new one for a new domain.

2. **Write the rule.** Every rule must implement `PrometheusRule`:

```typescript
import type { PrometheusRule, Finding } from '../types';

export const MY_NEW_RULE: PrometheusRule = {
  id: 'SEC_010',                    // Unique ID within the category prefix
  category: 'my_category',          // snake_case, stable across versions
  description: 'Short description', // Shown in findings output
  severity: 'HIGH',                 // BLOCKER | HIGH | MEDIUM | LOW | TECH_DEBT
  tags: ['security', 'api'],
  sinceVersion: '1.1.0',
  explain: {
    why: 'Why this rule exists — the risk if violated',
    commonViolations: ['Example of what gets flagged'],
    goodExample: '// Correct pattern\nconst val = getEnv("MY_VAR");',
    badExample: '// Flagged\nconst val = process.env.MY_VAR;',
    relatedPlaybooks: [],
    relatedAgents: [],
    relatedSkills: [],
  },
  detect({ changedFiles = [] }): Finding[] {
    const findings: Finding[] = [];
    for (const file of changedFiles) {
      // Pure logic — no fs access here
      if (/somePattern/.test(file.content)) {
        findings.push({
          severity: 'HIGH',
          file: file.path,
          category: 'my_category',
          message: 'Clear description of the violation',
          suggestion: 'What to do instead',
        });
      }
    }
    return findings;
  },
};
```

3. **Export it from the category file** and add it to the `PROMETHEUS_RULES` array in `rules/registry.ts`.

4. **Write a test.** Add a case in the relevant `*.test.ts` file:

```typescript
it('flags the bad pattern', () => {
  const findings = MY_NEW_RULE.detect({
    scan: minimalScan,
    config: defaultConfig,
    changedFiles: [{ path: 'src/foo.ts', content: 'process.env.MY_VAR' }],
  });
  expect(findings).toHaveLength(1);
  expect(findings[0].category).toBe('my_category');
});

it('does not flag the good pattern', () => {
  const findings = MY_NEW_RULE.detect({
    scan: minimalScan,
    config: defaultConfig,
    changedFiles: [{ path: 'src/foo.ts', content: 'getEnv("MY_VAR")' }],
  });
  expect(findings).toHaveLength(0);
});
```

5. **Run the registry integrity test:** `npm test -- rules/registry.test.ts` — it checks for duplicate IDs and missing required fields.

---

## Adding a built-in agent or skill

Agents and skills live in `catalog/agents/` and `catalog/skills/` respectively as Markdown files with YAML frontmatter.

**Agent frontmatter:**
```yaml
---
name: my-reviewer
type: agent
description: One-line description
tags: [security, api]
version: "1.0.0"
---
```

**Skill frontmatter:**
```yaml
---
name: my-audit
type: skill
description: One-line description
tags: [security]
version: "1.0.0"
---
```

Run `npm run prometheus:catalog:validate` to check that the frontmatter is valid before opening a PR.

---

## Commit conventions

Use [Conventional Commits](https://www.conventionalcommits.org/):

```
feat: add SEC_010 rule for missing rate-limit headers
fix: handle undefined changedFiles in review engine
docs: clarify failOnSeverity behaviour in README
test: add edge cases for drift detection
refactor: extract secret pattern matching to helpers
chore: bump vitest to 2.x
```

If your change affects the published package, also run `npx changeset` to record it for the CHANGELOG.

---

## Pull request process

1. Fork the repo and create a branch: `git checkout -b feat/my-feature`
2. Make your changes, add tests, run `npm test` and `npm run typecheck`
3. If you changed the package (not just docs/CI): `npx changeset` — follow the prompts
4. Open a PR against `main`
5. A maintainer will review and merge

PRs that lower test coverage thresholds or break the registry integrity test will not be merged.

---

## Reporting bugs

Open an issue at https://github.com/TenticleTim/prometheus-helper/issues with:

- The command you ran
- Expected vs. actual output
- Node version (`node -v`) and OS
- Relevant snippets of `.prometheus/config.json` (redact secrets)
