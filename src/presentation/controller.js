const { RefreshQueue } = require('../core/refreshQueue');
const { CONFIGURATION_SECTION, REFRESH_COMMAND, SHOW_OUTPUT_COMMAND } = require('./constants');

const GIT_ENABLED_CONFIGURATION = 'git.enabled';
const REPOSITORY_STATE_CHANGE = 'state';
const REPOSITORY_ENABLEMENT_CHANGE = 'enablement';

/** Coordinate editor events, repository selection, and queued status bar refreshes. */
class ExtensionController {
  /** @param {{
   * vscode: typeof import('vscode'),
   * repositories: import('../adapters/repositories').Repositories,
   * collectStats: ReturnType<import('../core/collectStats').createCollectStats>,
   * statusBar: import('./statusBar').StatusBar
   * }} dependencies */
  constructor({ vscode, repositories, collectStats, statusBar }) {
    this.vscode = vscode;
    this.repositories = repositories;
    this.collectStats = collectStats;
    this.statusBar = statusBar;
    this.disposed = false;

    /** @type {import('vscode').Disposable[]} */
    this.listeners = [];
    this.queue = new RefreshQueue(
      signal => this.collect(signal),
      result => statusBar.render(result),
      error => statusBar.fail(error)
    );
  }

  /** Register refresh triggers and wait for the initial, immediate refresh. */
  async start() {
    const vscode = this.vscode;
    const requestRefresh = () => { void this.queue.request(); };
    const handleSelectionChange = () => {
      const previousRepository = this.repositories.selected;
      const selectedRepository = this.repositories.resolveRepo();
      const repositoryChanged = previousRepository !== selectedRepository;

      if (repositoryChanged) this.statusBar.hide();
      void this.queue.request(false, repositoryChanged);
    };

    this.listeners.push(
      this.repositories.onDidChange(change => {
        const invalidateCurrentResult = change !== REPOSITORY_STATE_CHANGE;

        if (invalidateCurrentResult) this.statusBar.hide();
        void this.queue.request(change === REPOSITORY_ENABLEMENT_CHANGE, invalidateCurrentResult);
      }),
      vscode.commands.registerCommand(REFRESH_COMMAND, () => this.queue.request(true)),
      vscode.commands.registerCommand(SHOW_OUTPUT_COMMAND, () => this.statusBar.showOutput()),
      vscode.window.onDidChangeActiveTextEditor(handleSelectionChange),
      vscode.window.onDidChangeWindowState(event => {
        if (event.focused) requestRefresh();
      }),
      vscode.workspace.onDidSaveTextDocument(requestRefresh),
      vscode.workspace.onDidCreateFiles(requestRefresh),
      vscode.workspace.onDidDeleteFiles(requestRefresh),
      vscode.workspace.onDidRenameFiles(requestRefresh),
      vscode.workspace.onDidChangeConfiguration(event => {
        if (event.affectsConfiguration(CONFIGURATION_SECTION) || event.affectsConfiguration(GIT_ENABLED_CONFIGURATION)) {
          requestRefresh();
        }
      })
    );

    await this.queue.request(true);
  }

  /** Release the refresh queue and all owned subscriptions and presentation resources. */
  dispose() {
    if (this.disposed) return;

    this.disposed = true;
    this.queue.dispose();
    this.listeners.forEach(listener => listener.dispose());
    this.repositories.dispose();
    this.statusBar.dispose();
  }

  /**
   * Collect saved changes for the selected repository using its resource settings.
   * @param {AbortSignal} signal Cancels work when a refresh is superseded or disposed.
   * @returns {Promise<{repo: import('../adapters/git-api').Repository, stats: import('../core/stats').Stats, showRepositoryName: boolean} | undefined>}
   * Undefined hides the status bar when the workspace is untrusted or Git has no repository.
   */
  async collect(signal) {
    const vscode = this.vscode;
    if (!vscode.workspace.isTrusted) return undefined;

    await this.repositories.ensureGit();
    signal.throwIfAborted();

    const gitPath = this.repositories.getGitPath();
    if (!gitPath) return undefined;

    const repository = this.repositories.resolveRepo();
    if (!repository) return undefined;

    const configuration = vscode.workspace.getConfiguration(CONFIGURATION_SECTION, repository.rootUri);
    const stats = await this.collectStats(
      gitPath,
      repository.rootUri.fsPath,
      configuration.get('includeUntracked', true),
      signal
    );

    return { repo: repository, stats, showRepositoryName: this.repositories.hasMultipleRepositories() };
  }
}

module.exports = { ExtensionController };
