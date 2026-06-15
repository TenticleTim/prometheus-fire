/**
 * StatusBarManager — shows governance health in the VS Code status bar.
 *
 * States:
 *   loading  → $(sync~spin) Prometheus: analysing…
 *   healthy  → $(shield) A+  96         (no background)
 *   warning  → $(warning) B  72         (warningBackground)
 *   error    → $(error) 3 issues        (errorBackground)
 *   inactive → $(shield) Prometheus     (no background, no score)
 *   missing  → $(warning) Prometheus: scan needed
 */

import * as vscode from 'vscode';
import type { HealthScore } from './types.js';

export class StatusBarManager implements vscode.Disposable {
  private readonly item: vscode.StatusBarItem;

  constructor() {
    this.item = vscode.window.createStatusBarItem(
      vscode.StatusBarAlignment.Left,
      100,
    );
    this.item.command = 'prometheus.health';
    this.item.tooltip = 'Prometheus Governance — click to view health score';
    this.showInactive();
    this.item.show();
  }

  showLoading(): void {
    this.item.text = '$(sync~spin) Prometheus';
    this.item.tooltip = 'Prometheus Governance — analysing…';
    this.item.backgroundColor = undefined;
  }

  showHealth(health: HealthScore, findingCount: number): void {
    const { score, grade } = health;

    if (grade === 'A+' || grade === 'A') {
      this.item.text = `$(shield) ${grade}  ${score}`;
      this.item.backgroundColor = undefined;
    } else if (grade === 'B' || grade === 'C') {
      this.item.text = `$(warning) ${grade}  ${score}`;
      this.item.backgroundColor = new vscode.ThemeColor(
        'statusBarItem.warningBackground',
      );
    } else {
      this.item.text = `$(error) ${grade}  ${score}`;
      this.item.backgroundColor = new vscode.ThemeColor(
        'statusBarItem.errorBackground',
      );
    }

    const issueText =
      findingCount === 0
        ? 'No findings'
        : `${findingCount} finding${findingCount === 1 ? '' : 's'}`;

    this.item.tooltip = new vscode.MarkdownString(
      `**Prometheus Governance** — Health Score\n\n` +
        `Grade: **${grade}**   Score: **${score}/100**\n\n` +
        `${issueText}\n\n` +
        `_Click to open health dashboard_`,
    );
  }

  showScanNeeded(): void {
    this.item.text = '$(warning) Prometheus: scan needed';
    this.item.tooltip =
      'Prometheus Governance — run "Prometheus: Scan Repository" to start';
    this.item.backgroundColor = new vscode.ThemeColor(
      'statusBarItem.warningBackground',
    );
  }

  showNotInstalled(): void {
    this.item.text = '$(error) Prometheus: not installed';
    this.item.tooltip =
      'prometheus-governance not found — run: npm install --save-dev prometheus-governance';
    this.item.backgroundColor = new vscode.ThemeColor(
      'statusBarItem.errorBackground',
    );
  }

  showInactive(): void {
    this.item.text = '$(shield) Prometheus';
    this.item.tooltip = 'Prometheus Governance';
    this.item.backgroundColor = undefined;
  }

  hide(): void {
    this.item.hide();
  }

  show(): void {
    this.item.show();
  }

  dispose(): void {
    this.item.dispose();
  }
}
