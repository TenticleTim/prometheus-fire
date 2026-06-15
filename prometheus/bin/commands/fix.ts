/**
 * prometheus fix — auto-fix safe violations.
 *
 * Delegates all logic to the prometheus/fix.ts library module.
 * This file is intentionally thin: parse args → load data → call library → print.
 *
 * Flags:
 *   --apply          Write fixes to disk (default: dry-run/preview)
 *   --rule=<id>      Only fix this specific rule category
 *   --json           Machine-readable output
 */
import { createContext } from '../lib/context.ts';
import { parseArgs, flag, flagVal } from '../lib/args.ts';
import { loadReport } from '../lib/report.ts';
import { runReview } from '../../review.ts';
import { loadBaseline, partitionFindings } from '../../baseline.ts';
import { runFix, formatFixConsole, formatFixJson } from '../../fix.ts';

export async function cmdFix(argv: string[]): Promise<void> {
  const { root, config } = createContext();
  const { flags } = parseArgs(argv);
  const apply = flag(flags, 'apply');
  const ruleFilter = flagVal(flags, 'rule');
  const json = flag(flags, 'json');

  const scan = loadReport(root);
  if (!scan) {
    process.stderr.write(
      'prometheus fix: .prometheus/report.json not found — run prometheus scan first\n',
    );
    process.exit(1);
  }

  const allFindings = runReview({ scan, config });
  const baseline = loadBaseline(root);
  const findings = baseline
    ? partitionFindings(allFindings, baseline).newFindings
    : allFindings;

  const result = runFix(root, findings, { apply, ruleFilter: ruleFilter ?? undefined });

  if (json) {
    process.stdout.write(formatFixJson(result) + '\n');
  } else {
    process.stdout.write(formatFixConsole(result));
  }
}
