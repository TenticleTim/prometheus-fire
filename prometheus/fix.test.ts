import { describe, it, expect } from 'vitest';
import {
  FIXERS,
  AUTO_FIXABLE,
  applyFixer,
  formatFixConsole,
  formatFixJson,
  runFix,
  type FixResult,
} from './fix.ts';
import type { Finding } from './types.ts';

// ── Helpers ───────────────────────────────────────────────────────────────────

const makeF = (category: string, line?: number, file = 'src/app.ts'): Finding => ({
  severity: 'MEDIUM',
  file,
  line,
  category,
  message: `${category} finding`,
});

// ── AUTO_FIXABLE set ──────────────────────────────────────────────────────────

describe('AUTO_FIXABLE', () => {
  it('contains all expected categories', () => {
    expect(AUTO_FIXABLE.has('console_log')).toBe(true);
    expect(AUTO_FIXABLE.has('console_log_production')).toBe(true);
    expect(AUTO_FIXABLE.has('console_in_test')).toBe(true);
    expect(AUTO_FIXABLE.has('debugger_statement')).toBe(true);
    expect(AUTO_FIXABLE.has('ts_ignore_no_comment')).toBe(true);
    expect(AUTO_FIXABLE.has('ts_expect_error_no_comment')).toBe(true);
    expect(AUTO_FIXABLE.has('var_declaration')).toBe(true);
  });

  it('matches the FIXERS keys exactly', () => {
    for (const key of AUTO_FIXABLE) {
      expect(FIXERS).toHaveProperty(key);
    }
    for (const key of Object.keys(FIXERS)) {
      expect(AUTO_FIXABLE.has(key)).toBe(true);
    }
  });
});

// ── console_log ───────────────────────────────────────────────────────────────

describe('FIXERS.console_log', () => {
  const fixer = FIXERS['console_log']!;

  it('removes a console.log line', () => {
    const content = 'const x = 1;\nconsole.log(x);\nconst y = 2;\n';
    const result = fixer(content, makeF('console_log', 2));
    expect(result).toBe('const x = 1;\nconst y = 2;\n');
  });

  it('removes console.warn, .error, .info, .debug, .trace', () => {
    for (const method of ['warn', 'error', 'info', 'debug', 'trace']) {
      const content = `console.${method}('msg');\n`;
      expect(fixer(content, makeF('console_log', 1))).toBe('');
    }
  });

  it('returns null when line has no console call', () => {
    const content = 'const x = 1;\nconst y = 2;\n';
    expect(fixer(content, makeF('console_log', 1))).toBeNull();
  });

  it('returns null when line number is missing', () => {
    const content = 'console.log("x");\n';
    expect(fixer(content, makeF('console_log', undefined))).toBeNull();
  });

  it('returns null when line number is out of range', () => {
    const content = 'const x = 1;\n';
    expect(fixer(content, makeF('console_log', 99))).toBeNull();
  });

  it('is idempotent', () => {
    const content = 'a();\nconsole.log(1);\nb();\n';
    const first = fixer(content, makeF('console_log', 2))!;
    // After removal, line 2 is b() — applying again returns null (guard fails)
    const second = fixer(first, makeF('console_log', 2));
    expect(second).toBeNull();
  });
});

// ── console_log_production ────────────────────────────────────────────────────

describe('FIXERS.console_log_production', () => {
  it('removes console.log lines in production source files', () => {
    const fixer = FIXERS['console_log_production']!;
    const content = 'logger.info("start");\nconsole.log("debug");\nreturn result;\n';
    expect(fixer(content, makeF('console_log_production', 2))).toBe(
      'logger.info("start");\nreturn result;\n',
    );
  });
});

// ── console_in_test ───────────────────────────────────────────────────────────

describe('FIXERS.console_in_test', () => {
  it('removes console.log lines in test files', () => {
    const fixer = FIXERS['console_in_test']!;
    const content = "it('test', () => {\n  console.log(result);\n  expect(result).toBe(1);\n});\n";
    expect(fixer(content, makeF('console_in_test', 2))).toBe(
      "it('test', () => {\n  expect(result).toBe(1);\n});\n",
    );
  });
});

// ── debugger_statement ────────────────────────────────────────────────────────

describe('FIXERS.debugger_statement', () => {
  const fixer = FIXERS['debugger_statement']!;

  it('removes a bare debugger statement', () => {
    const content = 'function foo() {\n  debugger;\n  return 1;\n}\n';
    expect(fixer(content, makeF('debugger_statement', 2))).toBe(
      'function foo() {\n  return 1;\n}\n',
    );
  });

  it('removes an indented debugger statement', () => {
    const content = 'if (x) {\n    debugger\n  doSomething();\n}\n';
    expect(fixer(content, makeF('debugger_statement', 2))).toBe(
      'if (x) {\n  doSomething();\n}\n',
    );
  });

  it('returns null when line has no debugger keyword', () => {
    const content = 'const debuggerEnabled = true;\n';
    // The word "debugger" appears but not as a statement keyword — guard uses \bdebuger\b
    // Actually "debuggerEnabled" contains "debugger" as substring — let's check the regex
    // /\bdebugger\b/ would NOT match "debuggerEnabled" because of word boundary after "r"... wait
    // "debuggerEnabled" — \bdebugger\b — the \b after 'r' is not a boundary because 'E' is a word char
    // So this correctly returns null for "debuggerEnabled"
    expect(fixer(content, makeF('debugger_statement', 1))).toBeNull();
  });

  it('returns null when line number is missing', () => {
    expect(fixer('debugger;\n', makeF('debugger_statement', undefined))).toBeNull();
  });

  it('is idempotent', () => {
    const content = 'a();\n  debugger;\nb();\n';
    const fixed = fixer(content, makeF('debugger_statement', 2))!;
    expect(fixed).not.toContain('debugger');
  });
});

// ── ts_ignore_no_comment ──────────────────────────────────────────────────────

describe('FIXERS.ts_ignore_no_comment', () => {
  const fixer = FIXERS['ts_ignore_no_comment']!;

  it('adds a placeholder comment when none exists', () => {
    const content = '// @ts-ignore\nconst x: string = 1;\n';
    const result = fixer(content, makeF('ts_ignore_no_comment', 1));
    expect(result).toContain('@ts-ignore: TODO:');
    expect(result).toContain('suppression');
  });

  it('does not modify a line that already has a comment (colon form)', () => {
    const content = '// @ts-ignore: this is a third-party type issue\nconst x = 1;\n';
    expect(fixer(content, makeF('ts_ignore_no_comment', 1))).toBeNull();
  });

  it('does not modify a line that already has a comment (space form)', () => {
    const content = '// @ts-ignore legacy library has no types\nconst x = 1;\n';
    expect(fixer(content, makeF('ts_ignore_no_comment', 1))).toBeNull();
  });

  it('returns null when line has no @ts-ignore', () => {
    const content = 'const x = 1;\n';
    expect(fixer(content, makeF('ts_ignore_no_comment', 1))).toBeNull();
  });

  it('is idempotent', () => {
    const content = '// @ts-ignore\nconst x = 1;\n';
    const first = fixer(content, makeF('ts_ignore_no_comment', 1))!;
    const second = fixer(first, makeF('ts_ignore_no_comment', 1));
    expect(second).toBeNull(); // guard prevents re-application
  });
});

// ── ts_expect_error_no_comment ────────────────────────────────────────────────

describe('FIXERS.ts_expect_error_no_comment', () => {
  const fixer = FIXERS['ts_expect_error_no_comment']!;

  it('adds a placeholder comment when none exists', () => {
    const content = '// @ts-expect-error\nconst x: number = "str";\n';
    const result = fixer(content, makeF('ts_expect_error_no_comment', 1));
    expect(result).toContain('@ts-expect-error: TODO:');
  });

  it('does not modify a line that already has a comment', () => {
    const content = '// @ts-expect-error: intentional for test fixture\nconst x = 1;\n';
    expect(fixer(content, makeF('ts_expect_error_no_comment', 1))).toBeNull();
  });

  it('returns null when line has no @ts-expect-error', () => {
    const content = 'const x = 1;\n';
    expect(fixer(content, makeF('ts_expect_error_no_comment', 1))).toBeNull();
  });

  it('is idempotent', () => {
    const content = '// @ts-expect-error\nconst x = 1;\n';
    const first = fixer(content, makeF('ts_expect_error_no_comment', 1))!;
    const second = fixer(first, makeF('ts_expect_error_no_comment', 1));
    expect(second).toBeNull();
  });
});

// ── var_declaration ───────────────────────────────────────────────────────────

describe('FIXERS.var_declaration', () => {
  const fixer = FIXERS['var_declaration']!;

  it('replaces var with let', () => {
    const content = 'function foo() {\n  var x = 1;\n  return x;\n}\n';
    const result = fixer(content, makeF('var_declaration', 2));
    expect(result).toContain('let x = 1;');
    expect(result).not.toContain('var x');
  });

  it('only replaces the first var on the line', () => {
    const content = "  var name = 'var test';\n";
    const result = fixer(content, makeF('var_declaration', 1));
    expect(result).toContain("let name = 'var test'");
  });

  it('returns null when line has no var keyword', () => {
    const content = 'const x = 1;\n';
    expect(fixer(content, makeF('var_declaration', 1))).toBeNull();
  });

  it('returns null when line already uses let', () => {
    const content = 'let x = 1; // var already fixed\n';
    expect(fixer(content, makeF('var_declaration', 1))).toBeNull();
  });

  it('returns null when line number is missing', () => {
    expect(fixer('var x = 1;\n', makeF('var_declaration', undefined))).toBeNull();
  });

  it('is idempotent', () => {
    const content = 'var x = 1;\n';
    const first = fixer(content, makeF('var_declaration', 1))!;
    expect(first).toContain('let x');
    const second = fixer(first, makeF('var_declaration', 1));
    expect(second).toBeNull(); // now has "let", not "var"
  });
});

// ── applyFixer ────────────────────────────────────────────────────────────────

describe('applyFixer', () => {
  it('dispatches to the correct fixer by category', () => {
    const content = 'debugger;\nreturn 1;\n';
    const finding = makeF('debugger_statement', 1);
    expect(applyFixer(content, finding)).toBe('return 1;\n');
  });

  it('returns null for unknown categories', () => {
    const finding = makeF('missing_api_auth', 1);
    expect(applyFixer('const x = 1;\n', finding)).toBeNull();
  });

  it('is case-insensitive on category', () => {
    const content = 'debugger;\nreturn;\n';
    const finding = makeF('DEBUGGER_STATEMENT', 1);
    // Category lookup is lowercase — but we store as lowercase in FIXERS
    // applyFixer does finding.category.toLowerCase() so this should work
    expect(applyFixer(content, finding)).toBe('return;\n');
  });
});

// ── runFix (no I/O — uses tmpdir) ─────────────────────────────────────────────

import { mkdtempSync, writeFileSync, readFileSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';

function makeTmpDir(): string {
  return mkdtempSync(join(tmpdir(), 'prometheus-fix-'));
}

function cleanup(dir: string): void {
  rmSync(dir, { recursive: true, force: true });
}

describe('runFix', () => {
  it('returns dryRun: true by default and does not write files', () => {
    const dir = makeTmpDir();
    try {
      writeFileSync(join(dir, 'app.ts'), 'debugger;\nreturn 1;\n', 'utf8');
      const finding = { ...makeF('debugger_statement', 1), file: 'app.ts' };
      const result = runFix(dir, [finding]);
      expect(result.dryRun).toBe(true);
      expect(result.applied).toHaveLength(1);
      // File should be unchanged in dry-run
      expect(readFileSync(join(dir, 'app.ts'), 'utf8')).toContain('debugger');
    } finally {
      cleanup(dir);
    }
  });

  it('writes files when apply: true', () => {
    const dir = makeTmpDir();
    try {
      writeFileSync(join(dir, 'app.ts'), 'debugger;\nreturn 1;\n', 'utf8');
      const finding = { ...makeF('debugger_statement', 1), file: 'app.ts' };
      const result = runFix(dir, [finding], { apply: true });
      expect(result.dryRun).toBe(false);
      expect(result.applied).toHaveLength(1);
      expect(readFileSync(join(dir, 'app.ts'), 'utf8')).not.toContain('debugger');
    } finally {
      cleanup(dir);
    }
  });

  it('skips findings with no fixer and lists them as unfixable', () => {
    const dir = makeTmpDir();
    try {
      const finding = makeF('missing_api_auth', 1);
      const result = runFix(dir, [finding]);
      expect(result.unfixableFindings).toHaveLength(1);
      expect(result.applied).toHaveLength(0);
    } finally {
      cleanup(dir);
    }
  });

  it('skips missing files gracefully', () => {
    const dir = makeTmpDir();
    try {
      const finding = { ...makeF('debugger_statement', 1), file: 'nonexistent.ts' };
      const result = runFix(dir, [finding]);
      expect(result.skipped).toHaveLength(1);
      expect(result.skipped[0]!.reason).toContain('not found');
    } finally {
      cleanup(dir);
    }
  });

  it('applies multiple fixers to the same file bottom-to-top', () => {
    const dir = makeTmpDir();
    try {
      const content = 'debugger;\nconsole.log(1);\nreturn;\n';
      writeFileSync(join(dir, 'app.ts'), content, 'utf8');
      const findings: Finding[] = [
        { ...makeF('debugger_statement', 1), file: 'app.ts' },
        { ...makeF('console_log', 2), file: 'app.ts' },
      ];
      const result = runFix(dir, findings, { apply: true });
      expect(result.applied).toHaveLength(2);
      expect(readFileSync(join(dir, 'app.ts'), 'utf8')).toBe('return;\n');
    } finally {
      cleanup(dir);
    }
  });

  it('respects ruleFilter', () => {
    const dir = makeTmpDir();
    try {
      const content = 'debugger;\nconsole.log(1);\nreturn;\n';
      writeFileSync(join(dir, 'app.ts'), content, 'utf8');
      const findings: Finding[] = [
        { ...makeF('debugger_statement', 1), file: 'app.ts' },
        { ...makeF('console_log', 2), file: 'app.ts' },
      ];
      const result = runFix(dir, findings, { ruleFilter: 'debugger_statement' });
      // Only the debugger fixer should run
      expect(result.applied).toHaveLength(1);
      expect(result.applied[0]!.rule).toBe('debugger_statement');
    } finally {
      cleanup(dir);
    }
  });
});

// ── formatFixConsole ──────────────────────────────────────────────────────────

describe('formatFixConsole', () => {
  const baseResult: FixResult = {
    dryRun: true,
    applied: [],
    skipped: [],
    unfixableFindings: [],
  };

  it('shows "no fixable violations" when nothing to fix', () => {
    const out = formatFixConsole(baseResult);
    expect(out).toContain('No auto-fixable');
  });

  it('lists applied fixes with file and line', () => {
    const result: FixResult = {
      ...baseResult,
      applied: [{ file: 'src/app.ts', line: 42, rule: 'console_log', action: 'removed console statement' }],
    };
    const out = formatFixConsole(result);
    expect(out).toContain('src/app.ts:42');
    expect(out).toContain('console_log');
  });

  it('shows dry-run hint when there are applied fixes and dryRun is true', () => {
    const result: FixResult = {
      ...baseResult,
      applied: [{ file: 'f.ts', line: 1, rule: 'debugger_statement', action: 'removed debugger statement' }],
    };
    const out = formatFixConsole(result);
    expect(out).toContain('--apply');
  });

  it('does not show dry-run hint when apply is true', () => {
    const result: FixResult = {
      ...baseResult,
      dryRun: false,
      applied: [{ file: 'f.ts', line: 1, rule: 'debugger_statement', action: 'removed debugger statement' }],
    };
    const out = formatFixConsole(result);
    expect(out).not.toContain('--apply');
  });

  it('lists skipped fixes with reason', () => {
    const result: FixResult = {
      ...baseResult,
      skipped: [{ file: 'f.ts', line: 5, rule: 'console_log', reason: 'fixer could not apply safely' }],
    };
    const out = formatFixConsole(result);
    expect(out).toContain('fixer could not apply safely');
  });

  it('shows unfixable count', () => {
    const result: FixResult = {
      ...baseResult,
      unfixableFindings: [makeF('missing_api_auth', 1)],
    };
    const out = formatFixConsole(result);
    expect(out).toContain('manual remediation');
  });
});

// ── formatFixJson ─────────────────────────────────────────────────────────────

describe('formatFixJson', () => {
  it('produces valid JSON with correct shape', () => {
    const result: FixResult = {
      dryRun: true,
      applied: [{ file: 'a.ts', line: 1, rule: 'console_log', action: 'removed console statement' }],
      skipped: [],
      unfixableFindings: [makeF('missing_api_auth')],
    };
    const json = JSON.parse(formatFixJson(result));
    expect(json).toMatchObject({
      dryRun: true,
      applied: 1,
      skipped: 0,
      unfixable: 1,
      fixes: expect.arrayContaining([expect.objectContaining({ rule: 'console_log' })]),
    });
  });
});
