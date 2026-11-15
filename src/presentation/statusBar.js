const path = require('node:path');
const { GitError } = require('../adapters/git');
const { formatPrefix, validateColor, formatCount, formatTooltipMarkdown, shouldShowStats } = require('./formatting');
const { CONFIGURATION_SECTION, SHOW_OUTPUT_COMMAND } = require('./constants');

const SOURCE_CONTROL_COMMAND = 'workbench.view.scm';
const ADDED_STATUS_BAR_ID = `${CONFIGURATION_SECTION}.added`;
const REMOVED_STATUS_BAR_ID = `${CONFIGURATION_SECTION}.removed`;
const REPOSITORY_STATUS_BAR_ID = `${CONFIGURATION_SECTION}.repository`;
const MAX_REPOSITORY_LABEL_LENGTH = 32;
const DEFAULT_STATUS_BAR_PRIORITY = 1000000;

/** Own the additions/deletions indicators and their diagnostic output channel. */
class StatusBar {
  /** @param {typeof import('vscode')} vscode */
  constructor(vscode) {
    this.vscode = vscode;
    this.disposed = false;
    this.output = vscode.window.createOutputChannel('Difflet');
    const items = createStatusBarItems(vscode);
    this.addedItem = items.added;
    this.removedItem = items.removed;
    this.repositoryItem = items.repository;
  }

  /**
   * Update both indicators with repository settings and an untrusted Markdown tooltip.
   * @param {{repo: import('../adapters/git-api').Repository, stats: import('../core/stats').Stats, showRepositoryName?: boolean} | undefined} result
   * Missing or empty results hide both indicators.
   */
  render(result) {
    this.updatePosition();
    if (!result || !shouldShowStats(result.stats)) {
      this.hide();
      return;
    }

    const { repo: repository, stats } = result;
    const configuration = this.vscode.workspace.getConfiguration(CONFIGURATION_SECTION, repository.rootUri);
    const tooltip = new this.vscode.MarkdownString(formatTooltipMarkdown(path.basename(repository.rootUri.fsPath), stats));
    tooltip.isTrusted = false;
    tooltip.supportHtml = false;
    tooltip.supportThemeIcons = false;

    this.addedItem.text = `${formatPrefix(configuration.get('addedPrefix'))}+${formatCount(stats.added)}`;
    this.removedItem.text = `${formatPrefix(configuration.get('removedPrefix'))}−${formatCount(stats.deleted)}`;
    this.addedItem.color = validateColor(configuration.get('addedColor'));
    this.removedItem.color = validateColor(configuration.get('removedColor'));

    if (result.showRepositoryName) {
      const repositoryName = formatPrefix(path.basename(repository.rootUri.fsPath)).trim();
      const shortName = repositoryName.length > MAX_REPOSITORY_LABEL_LENGTH
        ? `${repositoryName.slice(0, MAX_REPOSITORY_LABEL_LENGTH - 1)}…` : repositoryName;
      this.repositoryItem.text = `${shortName} ·`;
      this.repositoryItem.tooltip = repository.rootUri.fsPath;
      this.repositoryItem.accessibilityInformation = { label: `Repository ${repositoryName}. Open Source Control.` };
      this.repositoryItem.command = SOURCE_CONTROL_COMMAND;
      this.repositoryItem.show();
    } else {
      this.repositoryItem.hide();
    }

    const partialTotalsLabel = Object.keys(stats.excluded).length ? ', partial totals' : '';
    this.addedItem.accessibilityInformation = { label: `${stats.added} lines added${partialTotalsLabel}. Open Source Control.` };
    this.removedItem.accessibilityInformation = { label: `${stats.deleted} lines deleted${partialTotalsLabel}. Open Source Control.` };

    for (const statusBarItem of [this.addedItem, this.removedItem]) {
      statusBarItem.command = SOURCE_CONTROL_COMMAND;
      statusBarItem.tooltip = tooltip;
      statusBarItem.show();
    }
  }

  /**
   * Log a safe diagnostic and replace the totals with a link to the output channel.
   * @param {unknown} error Only GitError messages are exposed in diagnostics.
   */
  fail(error) {
    this.updatePosition();
    const diagnosticMessage = error instanceof GitError
      ? error.message
      : 'Unable to refresh stats. Check Git availability and repository access.';
    this.output.appendLine(`${new Date().toISOString()} ${diagnosticMessage}`);

    this.removedItem.hide();
    this.repositoryItem.hide();
    this.addedItem.text = 'Git stats unavailable';
    this.addedItem.color = undefined;
    this.addedItem.tooltip = 'Unable to read Git statistics. Click to view diagnostics; run Difflet: Refresh to retry.';
    this.addedItem.command = SHOW_OUTPUT_COMMAND;
    this.addedItem.accessibilityInformation = { label: 'Git stats unavailable. Open diagnostic output.' };
    this.addedItem.show();
  }

  /** Recreate items when their immutable alignment or priority changes. */
  updatePosition() {
    const position = getStatusBarPosition(this.vscode);
    if (this.addedItem.alignment === position.alignment && this.addedItem.priority === position.priority) return;

    this.addedItem.dispose();
    this.removedItem.dispose();
    this.repositoryItem.dispose();
    const items = createStatusBarItems(this.vscode);
    this.addedItem = items.added;
    this.removedItem = items.removed;
    this.repositoryItem = items.repository;
  }

  hide() {
    this.addedItem.hide();
    this.removedItem.hide();
    this.repositoryItem.hide();
  }

  showOutput() {
    this.output.show();
  }

  /** Release all UI resources; repeated calls have no effect. */
  dispose() {
    if (this.disposed) return;

    this.disposed = true;
    [this.addedItem, this.removedItem, this.repositoryItem, this.output].forEach(resource => resource.dispose());
  }
}

/** Create the pair in addition/deletion order, preserving stable IDs for visibility preferences.
 * @param {typeof import('vscode')} vscode
 */
function createStatusBarItems(vscode) {
  const { alignment, priority } = getStatusBarPosition(vscode);
  const added = vscode.window.createStatusBarItem(ADDED_STATUS_BAR_ID, alignment, priority);
  const removed = vscode.window.createStatusBarItem(REMOVED_STATUS_BAR_ID, alignment, priority - 1);
  const repository = vscode.window.createStatusBarItem(REPOSITORY_STATUS_BAR_ID, alignment, priority + 1);
  repository.name = 'Difflet: Repository';
  added.name = 'Difflet: Additions';
  removed.name = 'Difflet: Deletions';

  return { added, removed, repository };
}

/** Read window-wide placement, falling back to defaults for invalid settings.
 * @param {typeof import('vscode')} vscode
 */
function getStatusBarPosition(vscode) {
  const configuration = vscode.workspace.getConfiguration(CONFIGURATION_SECTION);
  const alignment = configuration.get('alignment') === 'left'
    ? vscode.StatusBarAlignment.Left : vscode.StatusBarAlignment.Right;
  const configuredPriority = configuration.get('priority', DEFAULT_STATUS_BAR_PRIORITY);
  const priority = typeof configuredPriority === 'number' && Number.isFinite(configuredPriority)
    ? configuredPriority : DEFAULT_STATUS_BAR_PRIORITY;

  return { alignment, priority };
}

module.exports = { StatusBar };
