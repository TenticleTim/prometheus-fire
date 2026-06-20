/**
 * prometheus ci:github-security — generate a GitHub Actions workflow step
 * that uploads prometheus.sarif to the GitHub Security tab.
 *
 * Usage:
 *   prometheus ci:github-security             print YAML to stdout
 *   prometheus ci:github-security --write     write to .github/workflows/prometheus-security.yml
 */
import { writeFileSync, mkdirSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { flag } from '../lib/args.ts';
import { createContext } from '../lib/context.ts';

const WORKFLOW = `name: Prometheus Security Scan

on:
  push:
    branches: ["**"]
  pull_request:
    branches: [main]

permissions:
  contents: read
  security-events: write   # required for upload-sarif

jobs:
  prometheus:
    name: Governance Scan
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4

      - uses: actions/setup-node@v4
        with:
          node-version: 22.x
          cache: npm

      - name: Install dependencies
        run: npm ci

      - name: Run Prometheus scan
        run: npx prometheus scan

      - name: Export SARIF
        run: npx prometheus validate --sarif > prometheus.sarif

      - name: Upload to GitHub Security tab
        uses: github/codeql-action/upload-sarif@v3
        if: always()
        with:
          sarif_file: prometheus.sarif
          category: prometheus-governance
`;

export async function cmdCiGithubSecurity(argv: string[]): Promise<void> {
  const flags = Object.fromEntries(
    argv.filter((a) => a.startsWith('--')).map((a) => {
      const [k, v] = a.slice(2).split('=');
      return [k!, v ?? true];
    }),
  );

  const write = flag(flags, 'write');

  if (write) {
    const { root } = createContext();
    const dir = join(root, '.github', 'workflows');
    if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
    const dest = join(dir, 'prometheus-security.yml');
    writeFileSync(dest, WORKFLOW);
    process.stdout.write(`Wrote ${dest}\n`);
    process.stdout.write(`Commit and push — findings will appear in GitHub Security > Code scanning alerts.\n`);
  } else {
    process.stdout.write(WORKFLOW);
  }
}
