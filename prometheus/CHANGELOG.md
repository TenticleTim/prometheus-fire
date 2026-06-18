# Changelog

All notable changes to `prometheus-governance` will be documented here.

The format follows [Keep a Changelog](https://keepachangelog.com/en/1.0.0/) and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

---

## [1.2.0] — 2026-06-18

### Added

- **Slopsquatting Guard** (`prometheus import:scan`) — validates every npm/PyPI package in changed files against live registry APIs. Flags phantom packages (404), newly-registered packages (< 30 days old), and typosquat candidates (edit distance ≤ 2 from top packages). Works offline with graceful degradation. 10 new rules: SLOP_006–015.
- **Agent Scope Enforcement** (`prometheus scope:*`) — `.prometheus/scope.json` defines workspace boundaries and operation limits. PreToolUse hook intercepts every Write/Edit/Bash call and exits 2 on scope violations. Commands: `scope:init`, `scope:status`, `scope:check`.
- **Token Budget Governance** (`prometheus tokens:*`) — PostToolUse hook logs token usage per tool call to `.prometheus/token-usage.jsonl`. Enforces configurable session, daily, and project cost caps with alert and hard-stop thresholds. Commands: `tokens:report`, `tokens:reset`, `tokens:budget`.
- **AI Debt Fingerprinting** (`prometheus debt:scan`) — 20 new DEBT_001–020 rules that detect AI-specific code debt patterns traditional linters miss: duplicate function bodies, swallowed errors, magic numbers, O(n²) nested loops, vague variable names, commented-out blocks, missing `finally`, and more. Outputs a 0–100 debt score with A–F grade.
- **Context Health + Session Handoff** (`prometheus context:*`) — generates `.prometheus/context.md` from the live codebase (stack, established patterns, active constraints). `prometheus adapters` now auto-updates the snapshot. CLAUDE.md preamble now references `context.md` as step 1. Commands: `context:snapshot`, `context:health`.
- **Bash tool governance** — `claude:govern` PreToolUse hook now intercepts `Bash(npm install *)` / `Bash(pip install *)` calls and validates package names before they execute.
- **PostToolUse budget hook** — added to `.claude/settings.json` alongside existing PreToolUse and Stop hooks.
- **`tokenBudget` in `PrometheusConfig`** — configure token budgets directly in `.prometheus/config.json`.

### Fixed

- Token budget hook now reads usage from `hookData.usage` (top-level) — was incorrectly reading from `hookData.tool_response.usage` which is never populated.
- PyPI age check now uses the package's first-ever release date across all versions, not the latest-version upload time (which caused established packages to falsely appear new on release day).
- DEBT_007 (commented-out blocks) now correctly emits findings for blocks that run to end of file.
- DEBT_011 (magic numbers) no longer flags `UPPER_SNAKE_CASE` constant definitions — naming the constant is the correct fix.
- DEBT_007 now skips JSDoc blocks (`/**`) to prevent false-positives on `@example` code snippets.
- `getScopeStatus` now reports `allowDelete: false` / `allowGitPush: false` when unconfigured (was reporting `true`, implying permissions were granted when no scope was configured).
- CI: added `@rolldown/binding-linux-x64-gnu` and `linux-x64-musl` entries with resolved/integrity hashes to root lockfile (npm optional-dep bug identical to the lightningcss fix in 1.1.0).

### Changed

- `prometheus adapters` now auto-generates `.prometheus/context.md` on every run.
- CLAUDE.md "Before Each Task" checklist renumbered 1–12; step 1 now reads `.prometheus/context.md`.
- Token budget model cost table expanded with legacy date-suffixed model IDs (`claude-3-5-sonnet-20241022`, etc.) reported by older Claude Code versions.

---

## [1.1.0] — 2026-06-17

### Added

- **57 new governance rules** across three new domains:
  - **Python** (19 rules, PY_026–PY_045): async/await pitfalls, shell injection, `pickle`/`marshal` RCE, FastAPI/Django security patterns, Pydantic v2 migration, blocking I/O in async context, and more.
  - **GraphQL** (25 rules, GQL_001–GQL_025): query depth/complexity limits, resolver auth enforcement, N+1 without DataLoader, introspection disabled in production, type correctness, and production hardening.
  - **Terraform** (13 rules, TF_013–TF_025): sensitive IAM wildcards, open security groups (0.0.0.0/0), RDS deletion protection, KMS key rotation, secrets in `user_data`, `prevent_destroy` on critical resources, and S3 versioning.
- **3 new catalog agents**: `python-reviewer`, `graphql-reviewer`, `infrastructure-reviewer` — available via `prometheus catalog:enable`.
- **`prometheus claude:govern`** — installs Claude Code hooks into `.claude/settings.json` for real-time governance in Auto Mode:
  - `PreToolUse` (Write/Edit): blocks tool call (exit 2) if content contains any BLOCKER finding.
  - `Stop`: runs `prometheus drift` after each session to detect adapter staleness.
  - Install is idempotent; a `_prometheus_governance` marker prevents duplicate hook entries.
  - Autopilot permission profiles now preserve governance hooks when written/restored.

### Fixed

- Lockfile: added Linux lightningcss binaries (`lightningcss-linux-x64-gnu`, `lightningcss-linux-x64-musl`) with resolved/integrity hashes to fix CI failures on Ubuntu runners (npm optional-dependency bug).
- Multiple audit findings: security hardening, dead code removal, and wiring corrections across core modules.

---

## [1.0.0] — 2026-06-10

### Added

- **142 governance rules** across 8 categories: security, TypeScript, React, Next.js, AI/LLM, performance, database, and code quality
- **6 AI adapter targets**: Claude (`CLAUDE.md`), Gemini (`GEMINI.md`), Cursor (`.cursor/rules/prometheus.mdc`), Copilot (`.github/copilot-instructions.md`), Codex (`.codex/prometheus.md`), and `AGENTS.md` — all generated from a single canonical rule registry with zero duplication
- **CLI commands**: `init`, `scan`, `review`, `validate`, `audit`, `doctor`, `ci-check`, `adapters`, `drift`, `baseline:*`, `explain`, `suppressions:audit`, `metrics`, `pack:*`, `health`, `ci`, `fix`, `update`, `catalog:*`, `agent:create`, `skill:create`
- **Governance folder** (`.prometheus/`): README, config, GUARDRAILS, RULES, governance docs, architecture docs, and a GitHub Actions workflow — all scaffolded by `prometheus init`
- **Baseline system**: snapshot known technical debt so new violations are caught without blocking existing codebases
- **Inline suppressions**: `// prometheus-disable-next-line <id> -- reason: <text>` with expiry dates and audit trail
- **Health score** (0–100 with letter grade): synthesises findings, drift, suppressions, and baseline into a single governance grade
- **Metrics engine**: local-first, privacy-safe governance analytics with history tracking
- **Drift detection**: 12 categories of stale/missing governance artifacts
- **Rule explanation engine**: `prometheus explain <rule-id>` shows why a rule exists, good/bad examples, and related playbooks
- **Catalog system**: 50+ built-in agents and 50+ built-in skills; 5 composable profiles (base, web, next-supabase, enterprise)
- **Pack system**: extensible rule bundles for third-party frameworks
- **Zero runtime dependencies**: the entire tool ships without a single production dependency
- **JSON Schema** for `.prometheus/config.json`: add `$schema` for full editor autocomplete and validation
- **GitHub Actions CI/CD**: workflows for continuous integration (Node 18/20/22 matrix) and npm publishing on version tags

[1.0.0]: https://github.com/TenticleTim/prometheus-helper/releases/tag/v1.0.0
