/**
 * prometheus report — generate a visual HTML governance report.
 *
 * Flags:
 *   --html           emit a self-contained HTML report (default if no flag given)
 *   --out=<path>     write to file instead of stdout (default: .prometheus/report.html)
 *   --open           open the report in the default browser after writing
 *   --json           emit findings as JSON
 *   --markdown       emit findings as Markdown table
 */
import { existsSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { execSync } from 'node:child_process';
import { createContext } from '../lib/context.ts';
import { parseArgs, flag, flagVal } from '../lib/args.ts';
import { loadReport } from '../lib/report.ts';
import {
  runReview,
  formatFindingsJson,
  formatFindingsMarkdown,
} from '../../review.ts';
import { getActiveRules } from '../../packs.ts';
import type { Finding } from '../../types.ts';

// ── HTML renderer ─────────────────────────────────────────────────────────────

const SEVERITY_COLOR: Record<string, string> = {
  BLOCKER:   '#FF4444',
  HIGH:      '#FF8C00',
  MEDIUM:    '#F5C842',
  LOW:       '#4ADE80',
  TECH_DEBT: '#94A3B8',
};

const SEVERITY_BG: Record<string, string> = {
  BLOCKER:   'rgba(255,68,68,.1)',
  HIGH:      'rgba(255,140,0,.1)',
  MEDIUM:    'rgba(245,200,66,.1)',
  LOW:       'rgba(74,222,128,.08)',
  TECH_DEBT: 'rgba(148,163,184,.08)',
};

export function formatFindingsHtml(
  findings: Finding[],
  projectName = 'Project',
  scannedAt = new Date().toISOString(),
): string {
  const bySeverity = ['BLOCKER', 'HIGH', 'MEDIUM', 'LOW', 'TECH_DEBT'].map((sev) => ({
    sev,
    count: findings.filter((f) => f.severity === sev).length,
  }));

  const byCategory = new Map<string, number>();
  for (const f of findings) byCategory.set(f.category, (byCategory.get(f.category) ?? 0) + 1);
  const topCategories = [...byCategory.entries()].sort((a, b) => b[1] - a[1]).slice(0, 10);

  const byFile = new Map<string, Finding[]>();
  for (const f of findings) {
    const arr = byFile.get(f.file) ?? [];
    arr.push(f);
    byFile.set(f.file, arr);
  }

  const date = new Date(scannedAt).toLocaleString('en-US', {
    month: 'long', day: 'numeric', year: 'numeric',
    hour: '2-digit', minute: '2-digit',
  });

  const health = findings.length === 0 ? 'A+'
    : findings.some((f) => f.severity === 'BLOCKER') ? 'F'
    : findings.some((f) => f.severity === 'HIGH') ? 'D'
    : findings.filter((f) => f.severity === 'MEDIUM').length > 10 ? 'C'
    : findings.filter((f) => f.severity === 'MEDIUM').length > 0 ? 'B'
    : 'A';

  const healthColor = ['A+', 'A'].includes(health) ? '#4ADE80'
    : health === 'B' ? '#F5C842'
    : health === 'C' ? '#FF8C00'
    : '#FF4444';

  function renderFindings(list: Finding[]): string {
    return list.map((f) => `
      <div class="finding" style="border-left:3px solid ${SEVERITY_COLOR[f.severity]};background:${SEVERITY_BG[f.severity]}">
        <div class="finding-header">
          <span class="badge" style="color:${SEVERITY_COLOR[f.severity]};border-color:${SEVERITY_COLOR[f.severity]}20">${f.severity}</span>
          <span class="finding-cat">${f.category}</span>
          <span class="finding-loc">${f.file}${f.line != null ? `:${f.line}` : ''}</span>
        </div>
        <p class="finding-msg">${escHtml(f.message)}</p>
        ${f.suggestion ? `<p class="finding-fix">→ ${escHtml(f.suggestion)}</p>` : ''}
      </div>`).join('');
  }

  function escHtml(s: string): string {
    return s.replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');
  }

  const fileGroups = [...byFile.entries()]
    .sort((a, b) => {
      const sevOrder = ['BLOCKER','HIGH','MEDIUM','LOW','TECH_DEBT'];
      const aWorst = Math.min(...a[1].map((f) => sevOrder.indexOf(f.severity)));
      const bWorst = Math.min(...b[1].map((f) => sevOrder.indexOf(f.severity)));
      return aWorst - bWorst;
    })
    .map(([file, list]) => `
    <details class="file-group" open="${list.some((f) => f.severity === 'BLOCKER' || f.severity === 'HIGH')}">
      <summary class="file-summary">
        <span class="file-path">${escHtml(file)}</span>
        <span class="file-count">${list.length} finding${list.length === 1 ? '' : 's'}</span>
      </summary>
      <div class="file-findings">${renderFindings(list)}</div>
    </details>`).join('');

  return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8"/>
<meta name="viewport" content="width=device-width,initial-scale=1"/>
<title>Prometheus Report — ${escHtml(projectName)}</title>
<style>
  *,*::before,*::after{box-sizing:border-box;margin:0;padding:0}
  html{font-size:14px}
  body{background:#050408;color:#F5F0E8;font-family:-apple-system,BlinkMacSystemFont,'Inter','Segoe UI',sans-serif;line-height:1.6;-webkit-font-smoothing:antialiased}
  .page{max-width:980px;margin:0 auto;padding:48px 32px 96px}
  /* Header */
  .report-header{display:flex;align-items:flex-start;justify-content:space-between;gap:32px;margin-bottom:56px;padding-bottom:32px;border-bottom:1px solid rgba(255,255,255,.07)}
  .report-title{font-size:11px;letter-spacing:.18em;text-transform:uppercase;color:rgba(201,168,76,.6);margin-bottom:10px}
  .report-project{font-size:32px;font-weight:600;letter-spacing:-.02em;color:#F5F0E8}
  .report-date{font-size:12px;color:rgba(255,255,255,.3);margin-top:6px}
  .health-badge{text-align:center;flex-shrink:0}
  .health-grade{font-size:64px;font-weight:700;line-height:1;color:${healthColor};text-shadow:0 0 48px ${healthColor}44}
  .health-label{font-size:10px;letter-spacing:.14em;text-transform:uppercase;color:rgba(255,255,255,.3);margin-top:4px}
  /* Stat grid */
  .stats{display:grid;grid-template-columns:repeat(5,1fr);gap:1px;background:rgba(255,255,255,.06);border:1px solid rgba(255,255,255,.06);border-radius:12px;overflow:hidden;margin-bottom:48px}
  .stat{background:#09080F;padding:20px 18px;text-align:center}
  .stat-n{font-size:28px;font-weight:600;line-height:1}
  .stat-l{font-size:10px;letter-spacing:.14em;text-transform:uppercase;color:rgba(255,255,255,.3);margin-top:4px}
  /* Section */
  .section{margin-bottom:40px}
  .section-title{font-size:10px;letter-spacing:.22em;text-transform:uppercase;color:rgba(201,168,76,.6);margin-bottom:16px;display:flex;align-items:center;gap:10px}
  .section-title::before{content:'';display:block;width:16px;height:1px;background:rgba(201,168,76,.4)}
  /* Category pills */
  .cats{display:flex;flex-wrap:wrap;gap:8px;margin-bottom:40px}
  .cat-pill{display:flex;align-items:center;gap:8px;padding:8px 14px;border:1px solid rgba(255,255,255,.09);border-radius:8px;font-size:12px;color:rgba(255,255,255,.65)}
  .cat-pill-count{color:rgba(201,168,76,.8);font-weight:600;font-variant-numeric:tabular-nums}
  /* File groups */
  .file-group{border:1px solid rgba(255,255,255,.07);border-radius:10px;margin-bottom:10px;overflow:hidden}
  .file-summary{display:flex;align-items:center;justify-content:space-between;padding:12px 16px;cursor:pointer;list-style:none;background:rgba(255,255,255,.025)}
  .file-summary:hover{background:rgba(255,255,255,.04)}
  .file-path{font-family:'SF Mono','JetBrains Mono',monospace;font-size:12px;color:rgba(255,255,255,.75)}
  .file-count{font-size:11px;color:rgba(255,255,255,.3)}
  .file-findings{padding:12px 16px;display:flex;flex-direction:column;gap:8px}
  /* Finding */
  .finding{padding:12px 16px;border-radius:6px}
  .finding-header{display:flex;align-items:center;gap:10px;margin-bottom:6px;flex-wrap:wrap}
  .badge{font-size:10px;font-weight:600;letter-spacing:.1em;padding:2px 8px;border-radius:4px;border:1px solid;background:transparent}
  .finding-cat{font-family:'SF Mono','JetBrains Mono',monospace;font-size:11px;color:rgba(255,255,255,.4)}
  .finding-loc{font-family:'SF Mono','JetBrains Mono',monospace;font-size:11px;color:rgba(255,255,255,.3);margin-left:auto}
  .finding-msg{font-size:13px;color:rgba(255,255,255,.75);line-height:1.5}
  .finding-fix{font-size:12px;color:rgba(201,168,76,.7);margin-top:4px}
  /* Clean state */
  .clean{text-align:center;padding:64px 32px;border:1px solid rgba(74,222,128,.15);border-radius:12px;background:rgba(74,222,128,.04)}
  .clean-icon{font-size:48px;margin-bottom:16px}
  .clean-title{font-size:20px;font-weight:600;color:#4ADE80;margin-bottom:8px}
  .clean-sub{font-size:14px;color:rgba(255,255,255,.4)}
  /* Footer */
  .report-footer{margin-top:64px;padding-top:24px;border-top:1px solid rgba(255,255,255,.06);font-size:11px;color:rgba(255,255,255,.2);display:flex;justify-content:space-between}
</style>
</head>
<body>
<div class="page">
  <div class="report-header">
    <div>
      <div class="report-title">Prometheus Governance Report</div>
      <div class="report-project">${escHtml(projectName)}</div>
      <div class="report-date">${date}</div>
    </div>
    <div class="health-badge">
      <div class="health-grade">${health}</div>
      <div class="health-label">Health Grade</div>
    </div>
  </div>

  <div class="stats">
    ${bySeverity.map(({ sev, count }) => `
    <div class="stat">
      <div class="stat-n" style="color:${SEVERITY_COLOR[sev]}">${count}</div>
      <div class="stat-l">${sev}</div>
    </div>`).join('')}
  </div>

  ${findings.length === 0 ? `
  <div class="clean">
    <div class="clean-icon">🔱</div>
    <div class="clean-title">All checks passed</div>
    <div class="clean-sub">No governance violations detected.</div>
  </div>` : `
  <div class="section">
    <div class="section-title">Top categories</div>
    <div class="cats">
      ${topCategories.map(([cat, n]) => `
      <div class="cat-pill">
        <span>${escHtml(cat)}</span>
        <span class="cat-pill-count">${n}</span>
      </div>`).join('')}
    </div>
  </div>

  <div class="section">
    <div class="section-title">${findings.length} finding${findings.length === 1 ? '' : 's'} by file</div>
    ${fileGroups}
  </div>`}

  <div class="report-footer">
    <span>Prometheus Governance · <a href="https://github.com/TenticleTim/prometheus-fire" style="color:rgba(201,168,76,.5)">github.com/TenticleTim/prometheus-fire</a></span>
    <span>Built by Holley Studios</span>
  </div>
</div>
</body>
</html>`;
}

// ── Command ───────────────────────────────────────────────────────────────────

export async function cmdReport(argv: string[]): Promise<void> {
  const { root, config } = createContext();
  const { flags } = parseArgs(argv);
  const json     = flag(flags, 'json');
  const markdown = flag(flags, 'markdown');
  const open     = flag(flags, 'open');
  const outFlag  = flagVal(flags, 'out');

  const scan = loadReport(root);
  if (!scan) {
    process.stderr.write('prometheus report: .prometheus/report.json not found — run prometheus scan first\n');
    process.exit(1);
  }

  const registry = await getActiveRules(root);
  const findings = runReview({ scan, config }, registry);

  if (json) {
    process.stdout.write(formatFindingsJson(findings));
    return;
  }
  if (markdown) {
    process.stdout.write(formatFindingsMarkdown(findings, config.project));
    return;
  }

  const html = formatFindingsHtml(findings, config.project, scan.generatedAt);
  const outPath = outFlag ?? join(root, '.prometheus', 'report.html');

  writeFileSync(outPath, html, 'utf8');
  process.stdout.write(`\nPrometheus Report — ${config.project}\n`);
  process.stdout.write(`  ${findings.length} finding${findings.length === 1 ? '' : 's'} · written to ${outPath}\n\n`);

  if (open) {
    try {
      const cmd = process.platform === 'darwin' ? 'open'
        : process.platform === 'win32' ? 'start'
        : 'xdg-open';
      execSync(`${cmd} "${outPath}"`, { stdio: 'ignore' });
    } catch { /* best-effort */ }
  }
}
