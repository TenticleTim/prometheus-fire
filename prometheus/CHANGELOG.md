# Changelog

All notable changes to `prometheus-governance` will be documented here.

The format follows [Keep a Changelog](https://keepachangelog.com/en/1.0.0/) and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

---

## [2.0.0] — 2026-06-20

### Added

**6 New Governance Pillars:**

- **Pillar 1 — MCP Server** (`prometheus mcp:serve`, `prometheus mcp:install`) — Prometheus becomes a Model Context Protocol server. AI assistants call `scan_file`, `explain_rule`, `get_health`, `lint_commit`, and `get_context` *before* generating code. `mcp:install` writes the server entry into `~/.claude/settings.json`. New files: `prometheus/mcp-server.ts`, `prometheus/bin/commands/mcp.ts`.

- **Pillar 2 — Dependency Security** (`prometheus deps:audit`) — Async CVE scanning via OSV.dev (`api.osv.dev/v1/querybatch`). Results cached in `.prometheus/dep-cache.json` (24h TTL) and consumed synchronously by 10 new DEP_001–010 rules: critical CVE (BLOCKER), high/medium CVE, abandoned-with-CVE, no integrity hash, git dependency, major drift, prerelease in prod, deprecated package, stale cache. SBOM export via `--sbom` flag in CycloneDX 1.4 format. New files: `prometheus/osv-client.ts`, `prometheus/rules/deps.ts`, `prometheus/bin/commands/deps.ts`.

- **Pillar 3 — Agent Governance** — 12 new AGNT_001–012 rules detecting missing scope declarations, unconstrained Bash, ungoverned MCP servers, absent hooks, no token budget, no audit trail, and unrestricted network access. Dual-directory guard (`.claude/` AND `.prometheus/` must both exist) prevents false positives in dev environments. Plus tamper-evident **Agent Audit Trail** (`prometheus agent:audit:log|verify|report|export|rotate`) — append-only `.prometheus/audit.jsonl` with sha256 hash-chained entries using `node:crypto`. `verify` detects tampering by recomputing the entire chain. New files: `prometheus/agent-audit.ts`, `prometheus/rules/agents.ts`, `prometheus/bin/commands/agent-audit.ts`.

- **Pillar 4 — SARIF Output** (`prometheus validate --sarif`) — SARIF 2.1.0 JSON for GitHub Security tab, VS Code Problems panel, Azure DevOps. All 911 rules emit full `reportingDescriptor` metadata. `prometheus ci:github-security` generates a GitHub Actions workflow that uploads `prometheus.sarif` to `github/codeql-action/upload-sarif@v3`. New file: `prometheus/sarif.ts`.

- **Pillar 5 — License Compliance** — 10 new LIC_001–010 rules: GPL in commercial projects (BLOCKER), unknown/UNLICENSED deps, LGPL copyleft, missing LICENSE file, proprietary dep, invalid SPDX, dual-license ambiguity, AI training restriction, GPL/Apache incompatibility (BLOCKER), missing NOTICE file. All rules use the `changedFiles !== undefined` filesystem guard to avoid false positives in changed-files mode. New file: `prometheus/rules/license.ts`.

- **Pillar 6 — GDPR Compliance Pack** (`prometheus compliance:report --standard gdpr`) — 15 new GDPR_001–015 rules covering: PII in console.log, analytics without consent, cookie without consent banner, PII in URL params, PII in localStorage, missing data deletion endpoint, PII in external logging (BLOCKER), unencrypted PII in Prisma schema, missing privacy policy link, third-party tracking without consent, PII in API error responses (BLOCKER), missing retention policy, session without expiry, real PII in test fixtures, and IP storage without consent. `compliance:report --standard gdpr` generates an audit-ready Markdown evidence report mapping each finding to its GDPR article. New files: `prometheus/rules/gdpr.ts`, `prometheus/bin/commands/compliance.ts`.

**3 Quick Wins:**

- **Governance Certificate** (`prometheus certificate:generate`, `prometheus certificate:verify`) — Signed JSON artifact per delivery with sha256 hash chain for tamper detection. Fields: `rulesChecked`, `blockers`, `healthScore`, `healthGrade`, `hash`, `chain`. Agencies include in every delivery. New file: `prometheus/bin/commands/certificate.ts`.

- **Health Badge** (`prometheus health --badge`) — Prints shield.io badge markdown to stdout. Color ranges: ≥80 brightgreen, ≥70 green, ≥60 yellowgreen, ≥50 yellow, ≥40 orange, <40 red.

- **AI Code Fingerprinting** (`prometheus ai:fingerprint`) — Detects AI-generated files using git Co-Authored-By commit markers and static content heuristics (over-explained comments, step-numbered blocks, AI docstring patterns, boilerplate try/catch). Reports `aiGeneratedEstimate`, `topTool`, and per-file confidence scores. `--format json` for machine-readable output. New file: `prometheus/bin/commands/ai-fingerprint.ts`.

- Total rule count: **911** (864 previous + 12 AGNT + 10 DEP + 10 LIC + 15 GDPR).

### Changed

- `formatFindingsSarif()` in `review.ts` now delegates to `sarif.ts` for full rule metadata emission — all 911 rules appear in SARIF output regardless of whether they have findings.
- `prometheus health --badge` added as a new flag to the existing `health` command.
- README rule counts updated from 864 → 911.

---

## [1.3.0] — 2026-06-20

### Added

- **Conventional Commits Governance** (`prometheus commit:lint`, `prometheus commit:create`) — 10 new COMMIT_001–010 rules validate commit messages against the Conventional Commits specification using the standard `detect()` sentinel pattern (path `.git/COMMIT_EDITMSG`). Rules integrate with `explain`, `baseline`, and `suppressions:audit` automatically. `commit:lint` validates messages from the `commit-msg` hook, `--last`, or `--message "..."`. `commit:create` is an interactive wizard for building valid commit messages step-by-step.
- **Vercel Deployment Governance** (`prometheus vercel:lint`) — 10 new VERCEL_001–010 rules covering: literal secrets in `vercel.json` (BLOCKER), server secrets with `NEXT_PUBLIC_` prefix (BLOCKER), cron routes missing `CRON_SECRET` check (HIGH), env vars not documented in `.env.example` (HIGH), missing `.env.example` when env vars are used (HIGH), missing `maxDuration` in function config (MEDIUM), middleware missing edge runtime export (MEDIUM), missing security headers (MEDIUM), `maxDuration` exceeding plan limit (LOW), and open redirect patterns in redirects config (HIGH).
- **`commit-msg` git hook enforcement** — `prometheus hooks install --commit-msg` now writes a real enforcement block calling `prometheus commit:lint "$1"`. Previously a no-op placeholder.
- **`commitLint` and `vercel` config sections** in `PrometheusConfig` — customise allowed commit types, max subject length, ticket patterns, Vercel plan limits, and cron auth requirements via `.prometheus/config.json`.
- Total rule count: **864** (844 previous + 10 COMMIT + 10 VERCEL).

### Changed

- `generateHookBlock('commit-msg')` now generates a real enforcement script instead of a placeholder comment.
- `HookInstallOptions` gains optional `commitMsg?: boolean` field; `hooks install --commit-msg` installs the `commit-msg` hook alongside `pre-commit` and `pre-push`.

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
