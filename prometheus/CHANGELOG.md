# Changelog

All notable changes to `prometheus-governance` will be documented here.

The format follows [Keep a Changelog](https://keepachangelog.com/en/1.0.0/) and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

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
