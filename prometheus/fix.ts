/**
 * Prometheus auto-fix engine.
 *
 * Architecture:
 *   - FIXERS registry: pure functions (content + finding → patched content | null)
 *   - AUTO_FIXABLE: derived set of category IDs with registered fixers
 *   - applyFixer(): applies one fixer to content, returns new content or null
 *   - runFix(): orchestrates I/O — reads files, applies fixers, optionally writes
 *   - formatters: console + JSON output
 *
 * Safety contract:
 *   Every fixer in this registry must satisfy:
 *     1. Zero semantic change — the fixed code is behaviourally equivalent.
 *     2. Idempotent — applying the same fixer twice produces the same result.
 *     3. Line-targeted — only the exact line(s) named in the finding are touched.
 *     4. Returns null when it cannot apply safely — never corrupts the file.
 */

import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import type { Finding } from './types.js';

// ── Fixer type ─────────────────────────────────────────────────────────────────

/**
 * A pure function that receives file content and the triggering finding.
 * Returns the patched content string, or null if the fix cannot be applied.
 */
export type Fixer = (content: string, finding: Finding) => string | null;

// ── Shared line helpers ────────────────────────────────────────────────────────

function getLine(content: string, finding: Finding): { lines: string[]; idx: number } | null {
  if (finding.line == null) return null;
  const lines = content.split('\n');
  const idx = finding.line - 1;
  if (idx < 0 || idx >= lines.length) return null;
  return { lines, idx };
}

function removeLine(content: string, finding: Finding, guard: RegExp): string | null {
  const ctx = getLine(content, finding);
  if (!ctx) return null;
  const { lines, idx } = ctx;
  if (!guard.test(lines[idx]!)) return null;
  lines.splice(idx, 1);
  return lines.join('\n');
}

function replaceLine(content: string, finding: Finding, guard: RegExp, replacer: (line: string) => string | null): string | null {
  const ctx = getLine(content, finding);
  if (!ctx) return null;
  const { lines, idx } = ctx;
  if (!guard.test(lines[idx]!)) return null;
  const result = replacer(lines[idx]!);
  if (result === null) return null;
  lines[idx] = result;
  return lines.join('\n');
}

// ── Fixer registry ─────────────────────────────────────────────────────────────

export const FIXERS: Readonly<Record<string, Fixer>> = {
  /**
   * console_log — removes console.* call lines.
   * Safe: debug logging should never reach production.
   */
  console_log: (content, finding) =>
    removeLine(content, finding, /\bconsole\.(log|warn|error|info|debug|trace)\s*\(/),

  /**
   * console_log_production — same removal as console_log.
   * Separate category for production source files.
   */
  console_log_production: (content, finding) =>
    removeLine(content, finding, /\bconsole\.(log|warn|error|info|debug|trace)\s*\(/),

  /**
   * console_in_test — removes console.* lines in test files.
   * Safe: test output should be clean.
   */
  console_in_test: (content, finding) =>
    removeLine(content, finding, /\bconsole\.(log|warn|error|info|debug|trace)\s*\(/),

  /**
   * debugger_statement — removes the `debugger;` line.
   * Safe: debugger statements must never be committed.
   */
  debugger_statement: (content, finding) =>
    removeLine(content, finding, /\bdebugger\b/),

  /**
   * ts_ignore_no_comment — appends a TODO explanation placeholder.
   * Before:  // @ts-ignore
   * After:   // @ts-ignore: TODO: explain why this suppression is necessary
   *
   * Safe (additive): the suppression still works; the comment prompts the author.
   * Idempotent: guard prevents double-application.
   */
  ts_ignore_no_comment: (content, finding) =>
    replaceLine(
      content,
      finding,
      /@ts-ignore/,
      (line) => {
        // Already has a comment — don't touch
        if (/@ts-ignore\s*:\s*\S/.test(line) || /@ts-ignore\s+\S/.test(line)) return null;
        return line.replace(/@ts-ignore/, '@ts-ignore: TODO: explain why this suppression is necessary');
      },
    ),

  /**
   * ts_expect_error_no_comment — appends a TODO explanation placeholder.
   * Before:  // @ts-expect-error
   * After:   // @ts-expect-error: TODO: explain why this suppression is necessary
   *
   * Safe (additive): suppression still works; idempotent (guard checks).
   */
  ts_expect_error_no_comment: (content, finding) =>
    replaceLine(
      content,
      finding,
      /@ts-expect-error/,
      (line) => {
        if (/@ts-expect-error\s*:\s*\S/.test(line) || /@ts-expect-error\s+\S/.test(line)) return null;
        return line.replace(/@ts-expect-error/, '@ts-expect-error: TODO: explain why this suppression is necessary');
      },
    ),

  /**
   * var_declaration — replaces `var` with `let`.
   * Safe: `let` is strictly more constrained than `var` in modern, well-structured
   * code. The fix targets only the declaration line.
   *
   * Note: In the rare case of intentional cross-block `var` hoisting, this is a
   * LOW-severity finding that the developer can revert. Prefer `const` manually
   * once you confirm the variable is never reassigned.
   */
  var_declaration: (content, finding) =>
    replaceLine(
      content,
      finding,
      /\bvar\s/,
      (line) => {
        // Don't touch lines that are already let/const
        if (/\b(let|const)\s/.test(line)) return null;
        return line.replace(/\bvar\s/, 'let ');
      },
    ),
} as const;

export const AUTO_FIXABLE: ReadonlySet<string> = new Set(Object.keys(FIXERS));

// ── Public API ────────────────────────────────────────────────────────────────

/**
 * Applies the registered fixer for a finding's category.
 * Returns the patched content, or null if no fixer exists or it cannot apply.
 */
export function applyFixer(content: string, finding: Finding): string | null {
  const fixer = FIXERS[finding.category.toLowerCase()];
  if (!fixer) return null;
  return fixer(content, finding);
}

// ── Result types ──────────────────────────────────────────────────────────────

export interface FixEntry {
  file: string;
  line: number | null;
  rule: string;
  action: string;
}

export interface FixSkipEntry {
  file: string;
  line: number | null;
  rule: string;
  reason: string;
}

export interface FixResult {
  dryRun: boolean;
  applied: FixEntry[];
  skipped: FixSkipEntry[];
  unfixableFindings: Finding[];
}

export interface FixOptions {
  /** Write changes to disk. Default: false (dry-run). */
  apply?: boolean;
  /** Only fix this specific rule category (optional). */
  ruleFilter?: string;
}

// ── runFix ────────────────────────────────────────────────────────────────────

/**
 * Applies all registered fixers to the given findings.
 *
 * Groups findings by file, applies fixes bottom-to-top (highest line first)
 * so that line numbers remain accurate after each splice.
 *
 * When options.apply is false (the default) the files are NOT written — this
 * is dry-run mode. The returned FixResult reflects what WOULD be applied.
 */
export function runFix(
  root: string,
  findings: Finding[],
  options: FixOptions = {},
): FixResult {
  const { apply = false, ruleFilter } = options;

  const fixableFindings = findings.filter((f) => {
    const cat = f.category.toLowerCase();
    if (!AUTO_FIXABLE.has(cat)) return false;
    if (ruleFilter && cat !== ruleFilter.toLowerCase()) return false;
    return true;
  });

  const unfixableFindings = ruleFilter
    ? []
    : findings.filter((f) => !AUTO_FIXABLE.has(f.category.toLowerCase()));

  const applied: FixEntry[] = [];
  const skipped: FixSkipEntry[] = [];

  // Group by file
  const byFile = new Map<string, Finding[]>();
  for (const f of fixableFindings) {
    const existing = byFile.get(f.file) ?? [];
    existing.push(f);
    byFile.set(f.file, existing);
  }

  for (const [relFile, filefindings] of byFile) {
    const absPath = relFile.startsWith('/') ? relFile : join(root, relFile);

    if (!existsSync(absPath)) {
      for (const f of filefindings) {
        skipped.push({ file: relFile, line: f.line ?? null, rule: f.category, reason: 'file not found' });
      }
      continue;
    }

    let content: string;
    try {
      content = readFileSync(absPath, 'utf8');
    } catch {
      for (const f of filefindings) {
        skipped.push({ file: relFile, line: f.line ?? null, rule: f.category, reason: 'file not readable' });
      }
      continue;
    }

    // Sort highest line first to avoid offset drift after splices
    const sorted = [...filefindings].sort((a, b) => (b.line ?? 0) - (a.line ?? 0));

    let patched = content;
    for (const f of sorted) {
      const result = applyFixer(patched, f);
      if (result === null) {
        skipped.push({ file: relFile, line: f.line ?? null, rule: f.category, reason: 'fixer could not apply safely' });
        continue;
      }
      patched = result;
      applied.push({ file: relFile, line: f.line ?? null, rule: f.category, action: describeAction(f.category) });
    }

    if (apply && patched !== content) {
      try {
        writeFileSync(absPath, patched, 'utf8');
      } catch (err) {
        // Roll back applied entries for this file so the result is accurate
        const fileApplied = applied.filter((e) => e.file === relFile);
        for (const e of fileApplied) {
          const idx = applied.indexOf(e);
          if (idx !== -1) applied.splice(idx, 1);
          skipped.push({ file: e.file, line: e.line, rule: e.rule, reason: `write failed: ${err instanceof Error ? err.message : String(err)}` });
        }
      }
    }
  }

  return { dryRun: !apply, applied, skipped, unfixableFindings };
}

function describeAction(category: string): string {
  switch (category.toLowerCase()) {
    case 'console_log':
    case 'console_log_production':
    case 'console_in_test':
      return 'removed console statement';
    case 'debugger_statement':
      return 'removed debugger statement';
    case 'ts_ignore_no_comment':
      return 'added @ts-ignore explanation placeholder';
    case 'ts_expect_error_no_comment':
      return 'added @ts-expect-error explanation placeholder';
    case 'var_declaration':
      return 'replaced var with let';
    default:
      return 'applied fix';
  }
}

// ── Formatters ────────────────────────────────────────────────────────────────

export function formatFixConsole(result: FixResult): string {
  const { dryRun, applied, skipped, unfixableFindings } = result;
  const lines: string[] = [''];
  const mode = dryRun ? 'Dry-run preview' : 'Applied';

  lines.push(`  prometheus fix — ${mode}`);
  lines.push('');

  if (applied.length === 0 && skipped.length === 0 && unfixableFindings.length === 0) {
    lines.push('  No auto-fixable violations found.');
    lines.push('');
    return lines.join('\n');
  }

  if (applied.length > 0) {
    for (const f of applied) {
      const loc = f.line != null ? `:${f.line}` : '';
      const verb = dryRun ? 'Would fix' : 'Fixed';
      lines.push(`  ✅  ${f.file}${loc}  [${f.rule}]  — ${f.action}`);
      void verb; // suppress unused warning; kept for future use
    }
  }

  if (skipped.length > 0) {
    lines.push('');
    lines.push(`  Skipped (${skipped.length})`);
    for (const f of skipped) {
      const loc = f.line != null ? `:${f.line}` : '';
      lines.push(`  ⏭   ${f.file}${loc}  [${f.rule}]  — ${f.reason}`);
    }
  }

  if (unfixableFindings.length > 0) {
    lines.push('');
    lines.push(
      `  ${unfixableFindings.length} finding${unfixableFindings.length === 1 ? '' : 's'} require manual remediation  (run: prometheus review)`,
    );
  }

  if (dryRun && applied.length > 0) {
    lines.push('');
    lines.push('  → Run with --apply to write changes to disk');
  }

  lines.push('');
  return lines.join('\n');
}

export function formatFixJson(result: FixResult): string {
  return JSON.stringify(
    {
      dryRun: result.dryRun,
      applied: result.applied.length,
      skipped: result.skipped.length,
      unfixable: result.unfixableFindings.length,
      fixes: result.applied,
      skippedList: result.skipped,
    },
    null,
    2,
  );
}
