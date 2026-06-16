/**
 * Slopsquatting Rules — SLOP_001–005
 *
 * "Slopsquatting" — AI coding assistants hallucinate package names in import
 * statements. Research shows 19.7% of AI-generated code samples contain at
 * least one hallucinated package name, with 43% of hallucinated names
 * appearing consistently across identical prompts (making them trivially
 * exploitable: publish the fake package to npm and wait for installs).
 *
 * These rules catch phantom imports at the source-code level — before
 * `npm install` ever runs — which no other static analysis tool currently does.
 *
 * Reference: "Slopsquatting: AI Package Hallucination Attacks" (Aikido, 2025)
 */

import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import type { PrometheusRule, DetectInput, Finding } from '../types';
import { classifySeverity } from '../severity';

// ── Known hallucinated package names (documented by security researchers) ──────
// These are packages AI tools consistently invent that do not exist on npm.
// Updated based on Aikido Security, DZone, and Socket.dev research (2025).

const KNOWN_PHANTOMS = new Set([
  // Express ecosystem hallucinations
  'express-mongoose',
  'express-validator-middleware',
  'express-async-errors',
  'express-request-validator',
  'express-route-handler',
  'express-api-router',
  // React hallucinations
  'react-use-hooks',
  'react-hook-utils',
  'react-form-validator',
  'react-api-client',
  'react-query-utils',
  'react-state-manager',
  // Next.js hallucinations
  'next-auth-utils',
  'next-api-handler',
  'next-middleware-utils',
  'next-route-handler',
  'nextjs-helpers',
  // Database hallucinations
  'prisma-client-utils',
  'drizzle-utils',
  'db-connector',
  'database-utils',
  'mongoose-utils',
  'sequelize-helper',
  // Auth hallucinations
  'auth-helpers',
  'jwt-helper',
  'session-manager',
  'auth-middleware',
  'passport-jwt-helper',
  // Utility hallucinations
  'string-helpers',
  'array-utils',
  'object-helpers',
  'date-helpers',
  'type-helpers',
  'validation-utils',
  'error-handler',
  'logger-utils',
  // AI SDK hallucinations
  'openai-helper',
  'openai-utils',
  'anthropic-helper',
  'claude-sdk',
  'ai-helpers',
  'llm-utils',
  // Generic hallucinations
  'api-client',
  'http-client',
  'fetch-utils',
  'config-loader',
  'env-helper',
  'file-utils',
  'crypto-helper',
  'hash-utils',
]);

// Packages that look like squatting on popular names (common typosquats + AI variants)
const SUSPICIOUS_PATTERNS = [
  /^(react|next|express|prisma|drizzle|fastify|hono|vue|nuxt|angular)-(helper|util|utils|handler|middleware|wrapper|plugin|kit|tools?|lib|core|base|common|shared|extra|plus)s?$/,
  /^@(ai|llm|gpt|claude|openai|anthropic)\//,  // suspicious AI scopes
  /-(utils|helpers?|tools?)-(utils|helpers?|tools?)$/, // double suffix
];

// ── Parse package.json for installed packages ─────────────────────────────────

function getInstalledPackages(root: string): Set<string> {
  const pkgPath = join(root, 'package.json');
  if (!existsSync(pkgPath)) return new Set();
  try {
    const pkg = JSON.parse(readFileSync(pkgPath, 'utf8')) as {
      dependencies?: Record<string, string>;
      devDependencies?: Record<string, string>;
      peerDependencies?: Record<string, string>;
      optionalDependencies?: Record<string, string>;
    };
    return new Set([
      ...Object.keys(pkg.dependencies ?? {}),
      ...Object.keys(pkg.devDependencies ?? {}),
      ...Object.keys(pkg.peerDependencies ?? {}),
      ...Object.keys(pkg.optionalDependencies ?? {}),
    ]);
  } catch {
    return new Set();
  }
}

// ── Import parser — extract package names from import/require statements ───────

const IMPORT_RE = /^(?:import\s+.*\s+from\s+|import\s+|export\s+.*\s+from\s+|const\s+\w+\s*=\s*require\s*\()\s*['"`]([^'"`./][^'"`]*)['"`]/;
const DYNAMIC_IMPORT_RE = /(?:await\s+)?import\s*\(\s*['"`]([^'"`./][^'"`]*)['"`]\s*\)/;

function extractPackageName(importPath: string): string {
  // Scoped: @scope/name → @scope/name
  if (importPath.startsWith('@')) {
    const parts = importPath.split('/');
    return parts.slice(0, 2).join('/');
  }
  // Regular: package/subpath → package
  return importPath.split('/')[0];
}

function parseImports(content: string): Array<{ pkg: string; line: number }> {
  const imports: Array<{ pkg: string; line: number }> = [];
  const lines = content.split('\n');
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    const m = IMPORT_RE.exec(line) ?? DYNAMIC_IMPORT_RE.exec(line);
    if (m) {
      imports.push({ pkg: extractPackageName(m[1]), line: i + 1 });
    }
  }
  return imports;
}

// ── Built-in Node.js modules (these are never in package.json) ────────────────

const NODE_BUILTINS = new Set([
  'node:fs', 'node:path', 'node:os', 'node:crypto', 'node:http', 'node:https',
  'node:url', 'node:util', 'node:stream', 'node:events', 'node:child_process',
  'node:buffer', 'node:assert', 'node:net', 'node:dns', 'node:readline',
  'node:vm', 'node:module', 'node:worker_threads', 'node:perf_hooks',
  'node:inspector', 'node:cluster', 'node:zlib', 'node:querystring',
  'fs', 'path', 'os', 'crypto', 'http', 'https', 'url', 'util', 'stream',
  'events', 'child_process', 'buffer', 'assert', 'net', 'dns', 'readline',
  'vm', 'module', 'worker_threads', 'perf_hooks', 'inspector', 'cluster',
  'zlib', 'querystring', 'string_decoder', 'timers', 'tty', 'v8',
]);

// ── Slopsquatting Rules ───────────────────────────────────────────────────────

export const SLOPSQUATTING_RULES: PrometheusRule[] = [
  {
    id: 'SLOP_001',
    category: 'slop_phantom_import',
    description: 'Import references a package not listed in package.json — may be an AI-hallucinated phantom dependency.',
    severity: 'BLOCKER',
    tags: ['security', 'slopsquatting', 'ai-risk', 'supply-chain'],
    sinceVersion: '1.1.0',
    explain: {
      why: 'AI coding assistants hallucinate package names in 19.7% of code samples. When a phantom package is published to npm by an attacker before the developer notices, every `npm install` silently installs malicious code. This rule catches the phantom import in source before `npm install` ever runs.',
      commonViolations: [
        'import { Router } from "express-api-router" — does not exist on npm',
        'import { validate } from "react-form-validator" — AI invention',
        'import helpers from "next-middleware-utils" — hallucinated package',
      ],
      goodExample: 'import { Router } from "express"; // real package, in package.json',
      badExample: 'import { validate } from "express-mongoose"; // ❌ does not exist on npm',
      relatedPlaybooks: ['supply-chain-security.md'],
      relatedAgents: ['security-reviewer'],
      relatedSkills: [],
    },
    detect({ scan, changedFiles = [], config }: DetectInput): Finding[] {
      const sev = classifySeverity('slop_phantom_import', config.severityRules);
      const findings: Finding[] = [];

      // Find the repo root by looking for package.json via scan data
      // We use the riskyFiles / scriptFiles to approximate root, or fall back to cwd
      const installed = getInstalledPackages(process.cwd());
      if (installed.size === 0) return []; // can't check without package.json

      for (const { path, content } of changedFiles) {
        if (!/\.(ts|tsx|js|jsx|mjs|cjs)$/.test(path)) continue;
        const imports = parseImports(content);
        for (const { pkg, line } of imports) {
          if (NODE_BUILTINS.has(pkg)) continue;
          if (installed.has(pkg)) continue;
          if (KNOWN_PHANTOMS.has(pkg)) {
            findings.push({
              severity: sev,
              category: 'slop_phantom_import',
              file: path, line,
              message: `"${pkg}" is not in package.json and matches a known AI-hallucinated package name.`,
              suggestion: `Verify this package exists on npm (https://npmjs.com/package/${encodeURIComponent(pkg)}) and add it to package.json, or remove the import if it was hallucinated.`,
            });
          }
        }
      }
      return findings;
    },
  },

  {
    id: 'SLOP_002',
    category: 'slop_undeclared_import',
    description: 'Package imported in source code is not declared in package.json — phantom dependency or missing install.',
    severity: 'HIGH',
    tags: ['correctness', 'slopsquatting', 'ai-risk', 'supply-chain'],
    sinceVersion: '1.1.0',
    explain: {
      why: 'AI tools generate code that imports packages without checking if they\'re installed. Undeclared imports fail at runtime, cause "Module not found" errors in CI, and — if the package name happens to be one an attacker has squatted — silently install malicious code.',
      commonViolations: [
        'import { something } from "a-package-not-in-package-json"',
        'Missing package added to imports but not to dependencies',
        'AI generated a fully working code sample using a package it invented',
      ],
      goodExample: '// Always verify imports against package.json\n// Run: npm ls <package-name> to check it\'s installed',
      badExample: 'import { formatDate } from "date-helpers"; // ❌ not in package.json',
      relatedPlaybooks: ['dependency-management.md'],
      relatedAgents: ['security-reviewer'],
      relatedSkills: [],
    },
    detect({ changedFiles = [], config }: DetectInput): Finding[] {
      const sev = classifySeverity('slop_undeclared_import', config.severityRules);
      const findings: Finding[] = [];
      const installed = getInstalledPackages(process.cwd());
      if (installed.size === 0) return [];

      for (const { path, content } of changedFiles) {
        if (!/\.(ts|tsx|js|jsx|mjs|cjs)$/.test(path)) continue;
        const imports = parseImports(content);
        for (const { pkg, line } of imports) {
          if (NODE_BUILTINS.has(pkg)) continue;
          if (installed.has(pkg)) continue;
          if (KNOWN_PHANTOMS.has(pkg)) continue; // already caught by SLOP_001
          // Flag as undeclared — may be legit (monorepo workspace) or phantom
          findings.push({
            severity: sev,
            category: 'slop_undeclared_import',
            file: path, line,
            message: `"${pkg}" is imported but not found in package.json dependencies.`,
            suggestion: `Run \`npm install ${pkg}\` if this is a real package, or check if it was AI-hallucinated at https://npmjs.com/package/${encodeURIComponent(pkg)}.`,
          });
        }
      }
      return findings;
    },
  },

  {
    id: 'SLOP_003',
    category: 'slop_suspicious_package_name',
    description: 'Package name follows patterns common in AI-hallucinated packages (framework + generic suffix).',
    severity: 'MEDIUM',
    tags: ['security', 'slopsquatting', 'ai-risk', 'supply-chain'],
    sinceVersion: '1.1.0',
    explain: {
      why: 'AI tools hallucinate packages with predictable naming patterns: `react-utils`, `express-helper`, `next-api-handler`. These names sound real, exist on npm as unrelated or malicious packages, and get installed without scrutiny. Flagging suspicious patterns prompts manual verification.',
      commonViolations: [
        'react-utils — sounds like a real package, is actually unrelated',
        'express-helper — generic name with no canonical owner',
        'next-api-handler — AI-invented abstraction',
      ],
      goodExample: '// Use specific, well-maintained packages with clear ownership:\nimport { clsx } from "clsx"; // explicit, well-known\nimport type { FC } from "react"; // part of core React types',
      badExample: 'import { formatResponse } from "express-utils"; // ❌ generic name, verify it\'s real',
      relatedPlaybooks: ['supply-chain-security.md'],
      relatedAgents: ['security-reviewer'],
      relatedSkills: [],
    },
    detect({ changedFiles = [], config }: DetectInput): Finding[] {
      const sev = classifySeverity('slop_suspicious_package_name', config.severityRules);
      const findings: Finding[] = [];
      const installed = getInstalledPackages(process.cwd());

      for (const { path, content } of changedFiles) {
        if (!/\.(ts|tsx|js|jsx|mjs|cjs)$/.test(path)) continue;
        const imports = parseImports(content);
        for (const { pkg, line } of imports) {
          if (NODE_BUILTINS.has(pkg)) continue;
          if (installed.has(pkg)) continue;
          if (KNOWN_PHANTOMS.has(pkg)) continue; // caught by SLOP_001
          if (SUSPICIOUS_PATTERNS.some((re) => re.test(pkg))) {
            findings.push({
              severity: sev,
              category: 'slop_suspicious_package_name',
              file: path, line,
              message: `"${pkg}" has a generic name pattern common in AI-hallucinated packages.`,
              suggestion: `Verify this package is legitimate and maintained at https://npmjs.com/package/${encodeURIComponent(pkg)} before installing.`,
            });
          }
        }
      }
      return findings;
    },
  },

  {
    id: 'SLOP_004',
    category: 'slop_known_phantom_list',
    description: 'Import matches a package on the documented list of AI-hallucinated package names from security research.',
    severity: 'BLOCKER',
    tags: ['security', 'slopsquatting', 'ai-risk', 'supply-chain'],
    sinceVersion: '1.1.0',
    explain: {
      why: 'Security researchers have documented specific package names that AI tools hallucinate repeatedly across millions of code samples. These names have been registered on npm by researchers and attackers alike to prove the attack vector is real. Any occurrence in your codebase is almost certainly an AI hallucination.',
      commonViolations: KNOWN_PHANTOMS.size > 0 ? [...KNOWN_PHANTOMS].slice(0, 3).map((p) => `import ... from "${p}"`) : [],
      goodExample: 'Always verify new package imports against your package.json before committing.',
      badExample: [...KNOWN_PHANTOMS].slice(0, 1).map((p) => `import { foo } from "${p}"; // ❌ documented hallucination`).join('\n'),
      relatedPlaybooks: ['supply-chain-security.md'],
      relatedAgents: ['security-reviewer'],
      relatedSkills: [],
    },
    detect({ changedFiles = [], config }: DetectInput): Finding[] {
      const sev = classifySeverity('slop_known_phantom_list', config.severityRules);
      const findings: Finding[] = [];
      for (const { path, content } of changedFiles) {
        if (!/\.(ts|tsx|js|jsx|mjs|cjs)$/.test(path)) continue;
        const imports = parseImports(content);
        for (const { pkg, line } of imports) {
          if (KNOWN_PHANTOMS.has(pkg)) {
            findings.push({
              severity: sev,
              category: 'slop_known_phantom_list',
              file: path, line,
              message: `"${pkg}" appears on the documented list of AI-hallucinated package names. This package may not exist or may be malicious.`,
              suggestion: `Remove this import. If you need this functionality, find the real package that provides it (e.g., check npm for the canonical alternative).`,
            });
          }
        }
      }
      return findings;
    },
  },

  {
    id: 'SLOP_005',
    category: 'slop_ai_comment_import',
    description: 'Import immediately following an AI-generated code comment — high likelihood of hallucinated package.',
    severity: 'MEDIUM',
    tags: ['security', 'slopsquatting', 'ai-risk'],
    sinceVersion: '1.1.0',
    explain: {
      why: 'AI tools often add their own explanatory comments immediately before generated code blocks. An import following an "// AI generated" or "// Generated by" comment signals the import was written by an AI assistant and may not have been verified against a real package registry.',
      commonViolations: [
        '// Generated by Claude\nimport { something } from "invented-package"',
        '// AI: Using the express-validator-middleware package\nimport { validate } from "express-validator-middleware"',
        '// TODO: install this package\nimport { helper } from "helper-package"',
      ],
      goodExample: '// Verified: clsx is a real, maintained package\nimport { clsx } from "clsx";',
      badExample: '// AI: install this helper package\nimport { formatData } from "data-formatter-utils"; // ❌ verify before committing',
      relatedPlaybooks: ['supply-chain-security.md'],
      relatedAgents: ['security-reviewer'],
      relatedSkills: [],
    },
    detect({ changedFiles = [], config }: DetectInput): Finding[] {
      const sev = classifySeverity('slop_ai_comment_import', config.severityRules);
      const findings: Finding[] = [];
      const AI_COMMENT = /\/\/\s*(?:AI|Generated by|generated|TODO: install|install this|add this package|requires|needs package)/i;
      const installed = getInstalledPackages(process.cwd());

      for (const { path, content } of changedFiles) {
        if (!/\.(ts|tsx|js|jsx|mjs|cjs)$/.test(path)) continue;
        const lines = content.split('\n');
        for (let i = 0; i < lines.length - 1; i++) {
          if (!AI_COMMENT.test(lines[i])) continue;
          const nextLine = lines[i + 1];
          const m = IMPORT_RE.exec(nextLine);
          if (!m) continue;
          const pkg = extractPackageName(m[1]);
          if (NODE_BUILTINS.has(pkg) || installed.has(pkg)) continue;
          findings.push({
            severity: sev,
            category: 'slop_ai_comment_import',
            file: path, line: i + 2,
            message: `Import of "${pkg}" follows an AI-generated comment and is not in package.json — verify it exists.`,
            suggestion: `Check https://npmjs.com/package/${encodeURIComponent(pkg)} and run \`npm install ${pkg}\` if it's real, or remove the import if hallucinated.`,
          });
        }
      }
      return findings;
    },
  },
];
