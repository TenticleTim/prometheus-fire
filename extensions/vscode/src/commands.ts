/**
 * Command registrations for the Prometheus Governance extension.
 *
 * All commands are registered here and exposed as a Disposable so the
 * extension can cleanly tear them down on deactivation.
 *
 * Commands:
 *   prometheus.scan          — run `prometheus scan`, then refresh all findings
 *   prometheus.reviewFile    — review the currently open file
 *   prometheus.health        — open the health dashboard webview
 *   prometheus.adapters      — regenerate all AI adapter files
 *   prometheus.openConfig    — open .prometheus/config.json in the editor
 *   prometheus.refreshFindings — re-run full review and refresh the tree
 */

import * as vscode from 'vscode';
import { join } from 'node:path';
import { existsSync } from 'node:fs';

import {
  runScan,
  runHealth,
  runAdapters,
  PrometheusNotFoundError,
  PrometheusReportMissingError,
} from './runner.js';
import { HealthPanel } from './panel.js';
import type { ExtensionConfig } from './types.js';

// ── Callback types (supplied by extension.ts) ─────────────────────────────────

export type RefreshCallback = () => Promise<void>;
export type ReviewFileCallback = (uri: vscode.Uri) => Promise<void>;

// ── Helper ────────────────────────────────────────────────────────────────────

function handleError(err: unknown): void {
  if (err instanceof PrometheusNotFoundError) {
    void vscode.window.showErrorMessage(
      `Prometheus Governance: ${err.message}`,
      'Install now',
    ).then((choice) => {
      if (choice === 'Install now') {
        const terminal = vscode.window.createTerminal('Prometheus');
        terminal.sendText('npm install --save-dev prometheus-governance');
        terminal.show();
      }
    });
    return;
  }

  if (err instanceof PrometheusReportMissingError) {
    void vscode.window.showWarningMessage(
      `Prometheus Governance: ${err.message}`,
      'Scan now',
    ).then((choice) => {
      if (choice === 'Scan now') {
        void vscode.commands.executeCommand('prometheus.scan');
      }
    });
    return;
  }

  const message = err instanceof Error ? err.message : String(err);
  void vscode.window.showErrorMessage(`Prometheus Governance: ${message}`);
}

// ── Command factory ───────────────────────────────────────────────────────────

export function registerCommands(
  context: vscode.ExtensionContext,
  workspaceRoot: string,
  getConfig: () => ExtensionConfig,
  onRefresh: RefreshCallback,
  onReviewFile: ReviewFileCallback,
): vscode.Disposable {
  const disposables: vscode.Disposable[] = [];

  // ── prometheus.scan ────────────────────────────────────────────────────────

  disposables.push(
    vscode.commands.registerCommand('prometheus.scan', async () => {
      const cfg = getConfig();
      if (!cfg.enable) return;

      await vscode.window.withProgress(
        {
          location: vscode.ProgressLocation.Notification,
          title: 'Prometheus: Scanning repository…',
          cancellable: false,
        },
        async () => {
          try {
            await runScan(workspaceRoot, cfg.binaryPath || undefined);
            void vscode.window.showInformationMessage(
              'Prometheus: Scan complete. Refreshing findings…',
            );
            await onRefresh();
          } catch (err) {
            handleError(err);
          }
        },
      );
    }),
  );

  // ── prometheus.reviewFile ──────────────────────────────────────────────────

  disposables.push(
    vscode.commands.registerCommand('prometheus.reviewFile', async () => {
      const cfg = getConfig();
      if (!cfg.enable) return;

      const doc = vscode.window.activeTextEditor?.document;
      if (!doc) {
        void vscode.window.showWarningMessage(
          'Prometheus: No active file to review.',
        );
        return;
      }

      try {
        await onReviewFile(doc.uri);
        void vscode.window.showInformationMessage(
          `Prometheus: Review complete for ${doc.fileName.split('/').pop()}`,
        );
      } catch (err) {
        handleError(err);
      }
    }),
  );

  // ── prometheus.health ──────────────────────────────────────────────────────

  disposables.push(
    vscode.commands.registerCommand('prometheus.health', async () => {
      const cfg = getConfig();
      if (!cfg.enable) return;

      await vscode.window.withProgress(
        {
          location: vscode.ProgressLocation.Notification,
          title: 'Prometheus: Loading health score…',
          cancellable: false,
        },
        async () => {
          try {
            const health = await runHealth(
              workspaceRoot,
              cfg.binaryPath || undefined,
            );
            HealthPanel.show(context.extensionUri, health);
          } catch (err) {
            handleError(err);
          }
        },
      );
    }),
  );

  // ── prometheus.adapters ────────────────────────────────────────────────────

  disposables.push(
    vscode.commands.registerCommand('prometheus.adapters', async () => {
      const cfg = getConfig();
      if (!cfg.enable) return;

      await vscode.window.withProgress(
        {
          location: vscode.ProgressLocation.Notification,
          title: 'Prometheus: Regenerating AI adapters…',
          cancellable: false,
        },
        async () => {
          try {
            await runAdapters(workspaceRoot, cfg.binaryPath || undefined);
            void vscode.window.showInformationMessage(
              'Prometheus: AI adapter files updated (CLAUDE.md, GEMINI.md, .cursor/rules, …)',
            );
          } catch (err) {
            handleError(err);
          }
        },
      );
    }),
  );

  // ── prometheus.openConfig ──────────────────────────────────────────────────

  disposables.push(
    vscode.commands.registerCommand('prometheus.openConfig', async () => {
      const configPath = join(workspaceRoot, '.prometheus', 'config.json');
      if (!existsSync(configPath)) {
        void vscode.window.showWarningMessage(
          'Prometheus: .prometheus/config.json not found. Run "Prometheus: Scan Repository" first.',
        );
        return;
      }
      const doc = await vscode.workspace.openTextDocument(
        vscode.Uri.file(configPath),
      );
      await vscode.window.showTextDocument(doc);
    }),
  );

  // ── prometheus.refreshFindings ─────────────────────────────────────────────

  disposables.push(
    vscode.commands.registerCommand('prometheus.refreshFindings', async () => {
      const cfg = getConfig();
      if (!cfg.enable) return;

      try {
        await onRefresh();
      } catch (err) {
        handleError(err);
      }
    }),
  );

  return vscode.Disposable.from(...disposables);
}
