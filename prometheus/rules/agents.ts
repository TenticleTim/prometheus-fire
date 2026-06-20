/**
 * Agent Governance Rules — AGNT_001–012
 *
 * Detects missing or inadequate governance declarations in AI agent config
 * files (.claude/settings.json, .prometheus/scope.json, CLAUDE.md).
 *
 * All detection is STATIC: rules read config file content passed through
 * changedFiles, or check filesystem existence via existsSync — no network
 * calls, no async operations.
 *
 * These are the first rules to govern the AI agents themselves — not just
 * the code they produce.
 */

import type { PrometheusRule, DetectInput, Finding } from '../types.js';
import { existsSync } from 'node:fs';
import { join } from 'node:path';

// ── Helpers ───────────────────────────────────────────────────────────────────

function f(
  category: string,
  severity: Finding['severity'],
  message: string,
  suggestion: string,
  file: string,
): Finding {
  return { severity, file, category, message, suggestion };
}

function findFile(input: DetectInput, name: string): { path: string; content: string } | null {
  return input.changedFiles?.find((cf) => cf.path === name || cf.path.endsWith('/' + name)) ?? null;
}

function parseJson(content: string): Record<string, unknown> | null {
  try { return JSON.parse(content) as Record<string, unknown>; } catch { return null; }
}

function contentOf(input: DetectInput, name: string): string | null {
  return findFile(input, name)?.content ?? null;
}

// ── Rule: AGNT_001 — no scope file ───────────────────────────────────────────

const AGNT_001: PrometheusRule = {
  id: 'AGNT_001',
  category: 'agent_no_scope_declared',
  severity: 'HIGH',
  description: 'No .prometheus/scope.json found — agent file and network boundaries are undeclared.',
  tags: ['agent', 'governance', 'scope'],
  sinceVersion: '2.0.0',
  explain: {
    why: 'Without a scope file, AI agents can read and write anywhere in the repo and make arbitrary network calls. This creates a governance blind spot and violates least-privilege.',
    commonViolations: ['Agent has full filesystem access', 'No record of which paths the agent should touch'],
    goodExample: '{"version":"1.0","workspace":{"allowedPaths":["src/","tests/"],"blockedPaths":[".env"]}}',
    badExample: '(no .prometheus/scope.json file exists)',
  },
  detect(input: DetectInput): Finding[] {
    const root = process.cwd();
    // Only flag in projects that use BOTH Claude Code AND Prometheus (both dirs exist)
    if (!existsSync(join(root, '.claude')) || !existsSync(join(root, '.prometheus'))) return [];
    const scopePath = join(root, '.prometheus', 'scope.json');
    if (existsSync(scopePath)) return [];
    // Also pass if the changedFiles includes scope.json (it's being created)
    if (findFile(input, 'scope.json')) return [];
    return [f('agent_no_scope_declared', 'HIGH',
      'No .prometheus/scope.json found — agent boundaries are undeclared.',
      'Run: prometheus scope:init',
      '.prometheus/scope.json')];
  },
};

// ── Rule: AGNT_002 — no token budget ─────────────────────────────────────────

const AGNT_002: PrometheusRule = {
  id: 'AGNT_002',
  category: 'agent_no_token_budget',
  severity: 'HIGH',
  description: 'No tokenBudget configured — agent sessions have no cost ceiling.',
  tags: ['agent', 'governance', 'tokens'],
  sinceVersion: '2.0.0',
  explain: {
    why: 'Without a token budget, a runaway autonomous session can consume 10x expected tokens before anyone notices. A budget cap is the only hard protection against this.',
    commonViolations: ['No tokenBudget key in .prometheus/config.json', 'tokenBudget set to 0 or null'],
    goodExample: '{"tokenBudget":{"maxTokensPerSession":50000,"warnAtPercent":80}}',
    badExample: '{"project":"my-app"}',
  },
  detect(input: DetectInput): Finding[] {
    const configContent = contentOf(input, 'config.json');
    if (!configContent) return [];
    if (!configContent.includes('.prometheus')) return [];
    const cfg = parseJson(configContent);
    if (!cfg) return [];
    if (cfg.tokenBudget) return [];
    return [f('agent_no_token_budget', 'HIGH',
      'No tokenBudget in .prometheus/config.json — agent sessions are uncapped.',
      'Add: "tokenBudget": {"maxTokensPerSession": 50000, "warnAtPercent": 80}',
      '.prometheus/config.json')];
  },
};

// ── Rule: AGNT_003 — unrestricted bash ───────────────────────────────────────

const AGNT_003: PrometheusRule = {
  id: 'AGNT_003',
  category: 'agent_unrestricted_bash',
  severity: 'BLOCKER',
  description: '.claude/settings.json has no bash deny patterns — agent can run arbitrary shell commands.',
  tags: ['agent', 'security', 'bash', 'governance'],
  sinceVersion: '2.0.0',
  explain: {
    why: 'Without bash deny patterns, Claude Code in Auto Mode can execute rm -rf, curl to exfiltrate data, or any other shell command without restriction. This is the most critical agent safety gap.',
    commonViolations: ['Empty or missing permissions.deny array', 'No Bash deny rules in settings.json'],
    goodExample: '{"permissions":{"deny":["Bash(rm -rf **)","Bash(curl *:*)","Bash(wget **)"]}}',
    badExample: '{"permissions":{}}',
  },
  detect(input: DetectInput): Finding[] {
    const settingsContent = contentOf(input, 'settings.json');
    if (!settingsContent) return [];
    // Only check .claude/settings.json
    const settingsFile = findFile(input, 'settings.json');
    if (!settingsFile?.path.includes('.claude')) return [];

    const settings = parseJson(settingsContent);
    if (!settings) return [];

    const permissions = settings.permissions as Record<string, unknown> | undefined;
    const deny = permissions?.deny as unknown[] | undefined;
    if (Array.isArray(deny) && deny.some((d) => typeof d === 'string' && d.startsWith('Bash('))) {
      return [];
    }

    return [f('agent_unrestricted_bash', 'BLOCKER',
      '.claude/settings.json has no Bash deny rules — agent can execute any shell command.',
      'Add: "permissions": {"deny": ["Bash(rm -rf **)", "Bash(curl *:*)"]}',
      '.claude/settings.json')];
  },
};

// ── Rule: AGNT_004 — no hook governance ──────────────────────────────────────

const AGNT_004: PrometheusRule = {
  id: 'AGNT_004',
  category: 'agent_no_hook_governance',
  severity: 'MEDIUM',
  description: 'No PreToolUse hooks installed for Write/Edit operations — agent writes are ungoverned.',
  tags: ['agent', 'governance', 'hooks'],
  sinceVersion: '2.0.0',
  explain: {
    why: 'PreToolUse hooks for Write and Edit are the real-time governance layer. Without them, Prometheus governance only runs after code is written, not before.',
    commonViolations: ['No hooks key in .claude/settings.json', 'hooks array is empty'],
    goodExample: '{"hooks":{"PreToolUse":[{"matcher":"Write","hooks":[{"type":"command","command":"prometheus claude:govern check"}]}]}}',
    badExample: '{}',
  },
  detect(input: DetectInput): Finding[] {
    const settingsFile = findFile(input, 'settings.json');
    if (!settingsFile?.path.includes('.claude')) return [];

    const settings = parseJson(settingsFile.content);
    if (!settings) return [];

    const hooks = settings.hooks as Record<string, unknown[]> | undefined;
    if (!hooks) {
      return [f('agent_no_hook_governance', 'MEDIUM',
        'No PreToolUse hooks in .claude/settings.json — Write/Edit operations are ungoverned.',
        'Run: prometheus claude:govern install',
        '.claude/settings.json')];
    }
    const preToolUse = hooks['PreToolUse'] as unknown[] | undefined;
    if (!preToolUse || preToolUse.length === 0) {
      return [f('agent_no_hook_governance', 'MEDIUM',
        'PreToolUse hooks array is empty — Write/Edit operations are ungoverned.',
        'Run: prometheus claude:govern install',
        '.claude/settings.json')];
    }
    return [];
  },
};

// ── Rule: AGNT_005 — MCP server unverified ───────────────────────────────────

const AGNT_005: PrometheusRule = {
  id: 'AGNT_005',
  category: 'agent_mcp_server_unverified',
  severity: 'HIGH',
  description: 'MCP server registered without a pinned version or integrity hash — supply chain risk.',
  tags: ['agent', 'mcp', 'supply-chain', 'security'],
  sinceVersion: '2.0.0',
  explain: {
    why: 'An MCP server runs code with full access to Claude\'s tool system. An unpinned or unhashed server binary can be swapped for a malicious version without detection.',
    commonViolations: ['mcpServers entry uses "npx <package>" without version pin', 'No integrity hash in mcpServers config'],
    goodExample: '{"mcpServers":{"my-tool":{"command":"npx","args":["my-mcp-tool@1.2.3"]}}}',
    badExample: '{"mcpServers":{"my-tool":{"command":"npx","args":["my-mcp-tool"]}}}',
  },
  detect(input: DetectInput): Finding[] {
    const settingsFile = findFile(input, 'settings.json');
    if (!settingsFile?.path.includes('.claude')) return [];

    const settings = parseJson(settingsFile.content);
    if (!settings) return [];

    const mcpServers = settings.mcpServers as Record<string, { args?: string[] }> | undefined;
    if (!mcpServers || Object.keys(mcpServers).length === 0) return [];

    const unversioned = Object.entries(mcpServers).filter(([, server]) => {
      const args = server.args ?? [];
      return args.some((arg) => typeof arg === 'string' && !arg.includes('@') && !arg.startsWith('/'));
    });

    return unversioned.map(([name]) =>
      f('agent_mcp_server_unverified', 'HIGH',
        `MCP server "${name}" has no pinned version in its args — update to "@version" form.`,
        `Change "args": ["${name}"] to "args": ["${name}@<version>"]`,
        '.claude/settings.json'),
    );
  },
};

// ── Rule: AGNT_006 — tool permissions too broad ───────────────────────────────

const AGNT_006: PrometheusRule = {
  id: 'AGNT_006',
  category: 'agent_tool_permissions_too_broad',
  severity: 'MEDIUM',
  description: 'No tool allow/deny list configured — agent has implicit access to all tools.',
  tags: ['agent', 'governance', 'permissions'],
  sinceVersion: '2.0.0',
  explain: {
    why: 'Without an explicit allow or deny list, the agent can call any available tool. Least-privilege requires declaring which tools are needed.',
    commonViolations: ['settings.json has no permissions key', 'Empty permissions object with no allow or deny'],
    goodExample: '{"permissions":{"allow":["Read","Write","Edit","Bash(git *)"],"deny":["WebFetch(**)"]}}',
    badExample: '{}',
  },
  detect(input: DetectInput): Finding[] {
    const settingsFile = findFile(input, 'settings.json');
    if (!settingsFile?.path.includes('.claude')) return [];

    const settings = parseJson(settingsFile.content);
    if (!settings) return [];

    const permissions = settings.permissions as Record<string, unknown[]> | undefined;
    if (!permissions) {
      return [f('agent_tool_permissions_too_broad', 'MEDIUM',
        'No permissions declared in .claude/settings.json — all tools are implicitly allowed.',
        'Add "permissions": {"allow": [...], "deny": [...]} to restrict tool access.',
        '.claude/settings.json')];
    }
    if (
      (!permissions.allow || (permissions.allow as unknown[]).length === 0) &&
      (!permissions.deny || (permissions.deny as unknown[]).length === 0)
    ) {
      return [f('agent_tool_permissions_too_broad', 'MEDIUM',
        'Empty permissions object — no allow or deny list declared.',
        'Add an allow or deny list to enforce least-privilege tool access.',
        '.claude/settings.json')];
    }
    return [];
  },
};

// ── Rule: AGNT_007 — no constraints in CLAUDE.md ─────────────────────────────

const AGNT_007: PrometheusRule = {
  id: 'AGNT_007',
  category: 'agent_prompt_no_constraints',
  severity: 'HIGH',
  description: 'CLAUDE.md has no behavioral constraints section — agent behavior is unconstrained.',
  tags: ['agent', 'governance', 'claude', 'constraints'],
  sinceVersion: '2.0.0',
  explain: {
    why: 'CLAUDE.md is the primary way to declare behavioral rules for Claude Code. Without a constraints section, there is no documented governance, and the agent has no guidance on what it should refuse to do.',
    commonViolations: ['CLAUDE.md exists but contains only project info', 'No "Constraints", "Rules", or "Governance" heading'],
    goodExample: '# Constraints\n- Never delete files without explicit confirmation\n- Never push to main directly',
    badExample: '# My Project\nThis project uses React...',
  },
  detect(input: DetectInput): Finding[] {
    const claudeMd = findFile(input, 'CLAUDE.md');
    if (!claudeMd) return [];

    const content = claudeMd.content.toLowerCase();
    const hasConstraints =
      content.includes('# constraint') ||
      content.includes('## constraint') ||
      content.includes('# rule') ||
      content.includes('## rule') ||
      content.includes('# governance') ||
      content.includes('## governance') ||
      content.includes('# restriction') ||
      content.includes('## restriction') ||
      content.includes('never ') ||
      content.includes('must not ') ||
      content.includes('do not ');

    if (hasConstraints) return [];

    return [f('agent_prompt_no_constraints', 'HIGH',
      'CLAUDE.md has no behavioral constraints section.',
      'Add a "## Constraints" section with explicit rules for what the agent must never do.',
      'CLAUDE.md')];
  },
};

// ── Rule: AGNT_008 — data access unpinned ────────────────────────────────────

const AGNT_008: PrometheusRule = {
  id: 'AGNT_008',
  category: 'agent_data_access_unpinned',
  severity: 'HIGH',
  description: 'scope.json has no allowedPaths — agent can access all files in the repo.',
  tags: ['agent', 'governance', 'scope'],
  sinceVersion: '2.0.0',
  explain: {
    why: 'Without an allowedPaths constraint, an agent can read secrets, config files, and private data outside its intended scope. allowedPaths is the filesystem least-privilege boundary.',
    commonViolations: ['scope.json exists but workspace.allowedPaths is empty', 'allowedPaths not set'],
    goodExample: '{"workspace":{"allowedPaths":["src/","tests/","package.json"]}}',
    badExample: '{"workspace":{}}',
  },
  detect(input: DetectInput): Finding[] {
    const scopeFile = findFile(input, 'scope.json');
    if (!scopeFile) return [];
    if (!scopeFile.path.includes('.prometheus')) return [];

    const scope = parseJson(scopeFile.content);
    if (!scope) return [];

    const workspace = scope.workspace as { allowedPaths?: string[] } | undefined;
    if (workspace?.allowedPaths && workspace.allowedPaths.length > 0) return [];

    return [f('agent_data_access_unpinned', 'HIGH',
      'scope.json has no allowedPaths — agent has unrestricted file access.',
      'Add: "workspace": {"allowedPaths": ["src/", "tests/"]}',
      '.prometheus/scope.json')];
  },
};

// ── Rule: AGNT_009 — sub-agent ungoverned ────────────────────────────────────

const AGNT_009: PrometheusRule = {
  id: 'AGNT_009',
  category: 'agent_sub_agent_ungoverned',
  severity: 'HIGH',
  description: 'Agent spawning (Agent tool) is not mentioned in governance config — sub-agents are ungoverned.',
  tags: ['agent', 'governance', 'sub-agents'],
  sinceVersion: '2.0.0',
  explain: {
    why: 'Sub-agents spawned by the Agent tool inherit no governance from the parent session by default. Without explicit governance declarations, sub-agent actions are invisible to the audit trail.',
    commonViolations: ['CLAUDE.md mentions using Agent tool but no governance rules for it', 'No agent spawn restrictions in scope.json'],
    goodExample: '## Sub-Agent Rules\n- All sub-agents must be spawned with isolation: "worktree"\n- Sub-agents must not have internet access',
    badExample: '(no mention of Agent tool governance in any config file)',
  },
  detect(input: DetectInput): Finding[] {
    const claudeMd = findFile(input, 'CLAUDE.md');
    if (!claudeMd) return [];

    const content = claudeMd.content.toLowerCase();
    // If CLAUDE.md mentions spawning agents but no governance rules
    const mentionsAgents = content.includes('agent tool') || content.includes('spawn') || content.includes('sub-agent') || content.includes('subagent');
    if (!mentionsAgents) return [];

    const hasAgentGovernance =
      content.includes('sub-agent') && (content.includes('must') || content.includes('never') || content.includes('rule') || content.includes('govern'));

    if (hasAgentGovernance) return [];

    return [f('agent_sub_agent_ungoverned', 'HIGH',
      'CLAUDE.md mentions agent spawning but has no sub-agent governance rules.',
      'Add a "## Sub-Agent Rules" section declaring governance constraints for spawned agents.',
      'CLAUDE.md')];
  },
};

// ── Rule: AGNT_010 — no audit trail ──────────────────────────────────────────

const AGNT_010: PrometheusRule = {
  id: 'AGNT_010',
  category: 'agent_no_audit_trail',
  severity: 'MEDIUM',
  description: 'No .prometheus/audit.jsonl found — agent actions are not being logged.',
  tags: ['agent', 'audit', 'governance'],
  sinceVersion: '2.0.0',
  explain: {
    why: 'Without an audit trail, there is no record of what an AI agent read, wrote, or executed. This makes incident response impossible and fails most compliance frameworks.',
    commonViolations: ['claude:govern hooks not installed', 'audit.jsonl never created'],
    goodExample: '.prometheus/audit.jsonl with tamper-evident hash chain entries',
    badExample: '(file does not exist)',
  },
  detect(input: DetectInput): Finding[] {
    const root = process.cwd();
    // Only flag in projects that use BOTH Claude Code AND Prometheus
    if (!existsSync(join(root, '.claude')) || !existsSync(join(root, '.prometheus'))) return [];
    const auditPath = join(root, '.prometheus', 'audit.jsonl');
    // If audit.jsonl is in changedFiles (being created), it passes
    if (findFile(input, 'audit.jsonl')) return [];
    if (existsSync(auditPath)) return [];
    return [f('agent_no_audit_trail', 'MEDIUM',
      'No .prometheus/audit.jsonl — agent actions are not being logged.',
      'Run: prometheus claude:govern install  to enable audit logging.',
      '.prometheus/audit.jsonl')];
  },
};

// ── Rule: AGNT_011 — no session timeout ──────────────────────────────────────

const AGNT_011: PrometheusRule = {
  id: 'AGNT_011',
  category: 'agent_session_timeout_missing',
  severity: 'LOW',
  description: 'No maxSessionMinutes configured — agent sessions can run indefinitely.',
  tags: ['agent', 'governance', 'tokens'],
  sinceVersion: '2.0.0',
  explain: {
    why: 'A stalled or runaway agent session without a timeout continues consuming tokens and potentially writing incorrect code. A session timeout is the last-resort safeguard.',
    commonViolations: ['config.json has tokenBudget but no maxSessionMinutes'],
    goodExample: '{"tokenBudget":{"maxTokensPerSession":50000,"maxSessionMinutes":60}}',
    badExample: '{"tokenBudget":{"maxTokensPerSession":50000}}',
  },
  detect(input: DetectInput): Finding[] {
    const configFile = findFile(input, 'config.json');
    if (!configFile?.path.includes('.prometheus')) return [];

    const cfg = parseJson(configFile.content);
    if (!cfg) return [];

    const budget = cfg.tokenBudget as Record<string, unknown> | undefined;
    if (!budget) return []; // AGNT_002 covers the missing budget case
    if (budget.maxSessionMinutes) return [];

    return [f('agent_session_timeout_missing', 'LOW',
      'tokenBudget has no maxSessionMinutes — sessions can run indefinitely.',
      'Add: "maxSessionMinutes": 60 to your tokenBudget config.',
      '.prometheus/config.json')];
  },
};

// ── Rule: AGNT_012 — network unrestricted ────────────────────────────────────

const AGNT_012: PrometheusRule = {
  id: 'AGNT_012',
  category: 'agent_network_unrestricted',
  severity: 'MEDIUM',
  description: 'No allowedNetworkHosts in scope.json — agent can make unrestricted network calls.',
  tags: ['agent', 'governance', 'network', 'scope'],
  sinceVersion: '2.0.0',
  explain: {
    why: 'An agent with unrestricted network access can exfiltrate code, credentials, or data to any external host. allowedNetworkHosts is the network least-privilege boundary.',
    commonViolations: ['scope.json exists but operations.allowNetworkHosts is missing or empty'],
    goodExample: '{"operations":{"allowNetworkHosts":["api.github.com","registry.npmjs.org"]}}',
    badExample: '{"operations":{}}',
  },
  detect(input: DetectInput): Finding[] {
    const scopeFile = findFile(input, 'scope.json');
    if (!scopeFile?.path.includes('.prometheus')) return [];

    const scope = parseJson(scopeFile.content);
    if (!scope) return [];

    const ops = scope.operations as { allowNetworkHosts?: string[] } | undefined;
    if (!ops) {
      return [f('agent_network_unrestricted', 'MEDIUM',
        'scope.json has no operations section — network access is unrestricted.',
        'Add: "operations": {"allowNetworkHosts": ["api.github.com"]}',
        '.prometheus/scope.json')];
    }
    if (ops.allowNetworkHosts && ops.allowNetworkHosts.length > 0) return [];
    return [f('agent_network_unrestricted', 'MEDIUM',
      'scope.json operations.allowNetworkHosts is empty — all network access is blocked or unrestricted.',
      'Declare allowed hosts: "allowNetworkHosts": ["api.github.com", "registry.npmjs.org"]',
      '.prometheus/scope.json')];
  },
};

// ── Export ────────────────────────────────────────────────────────────────────

export const AGENT_RULES: PrometheusRule[] = [
  AGNT_001,
  AGNT_002,
  AGNT_003,
  AGNT_004,
  AGNT_005,
  AGNT_006,
  AGNT_007,
  AGNT_008,
  AGNT_009,
  AGNT_010,
  AGNT_011,
  AGNT_012,
];
