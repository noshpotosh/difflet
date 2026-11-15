const GIT_EXTENSION_ID = 'vscode.git';
const GIT_API_VERSION = 1;
const REPOSITORY_CHANGE = /** @type {const} */ ({
  ENABLEMENT: 'enablement',
  REPOSITORIES: 'repositories',
  STATE: 'state'
});

/** @typedef {typeof REPOSITORY_CHANGE[keyof typeof REPOSITORY_CHANGE]} RepositoryChange */

/** Track Git availability, repository selection, and subscriptions owned by the adapter. */
class Repositories {
  /** @param {typeof import('vscode')} vscode */
  constructor(vscode) {
    this.vscode = vscode;
    this.disposed = false;

    /** @type {import('./git-api').GitAPI | undefined} */
    this.api = undefined;
    /** @type {import('./git-api').GitExtension | undefined} */
    this.gitExtension = undefined;
    /** @type {import('./git-api').Repository | undefined} */
    this.selected = undefined;

    /** @type {import('vscode').Disposable[]} */
    this.listeners = [];
    /** @type {import('vscode').Disposable[]} */
    this.repositoryListeners = [];
    /** @type {import('vscode').Disposable[]} */
    this.apiListeners = [];
    /** @type {Set<(change: RepositoryChange) => void>} */
    this.changeListeners = new Set();
  }

  /**
   * Subscribe to changes that may require refreshing the displayed statistics.
   * @param {(change: RepositoryChange) => void} listener
   * @returns {import('vscode').Disposable} Unsubscribes this listener when disposed.
   */
  onDidChange(listener) {
    this.changeListeners.add(listener);

    return { dispose: () => { this.changeListeners.delete(listener); } };
  }

  /** Activate Git if needed and bind its API only while the extension is enabled. */
  async ensureGit() {
    await this.activateGit();
    if (this.disposed) return;

    this.bindAPI(this.gitExtension?.enabled ? this.gitExtension.getAPI(GIT_API_VERSION) : undefined);
  }

  /**
   * Select only the active file's repository; unrelated files clear the selection.
   * Without a text editor, retain the previous selection only while it remains open.
   * @returns {import('./git-api').Repository | undefined}
   */
  resolveRepo() {
    const api = this.api;
    const activeDocumentUri = this.vscode.window.activeTextEditor?.document.uri;
    const editorRepository = api && activeDocumentUri ? api.getRepository(activeDocumentUri) : undefined;
    const candidate = activeDocumentUri ? editorRepository : this.selected;
    const openRepository = candidate
      ? api?.repositories.find(repository => repository.rootUri.fsPath === candidate.rootUri.fsPath)
      : undefined;

    // Git API calls return fresh wrappers, so identify repositories by their root.
    if (!openRepository) {
      this.selected = undefined;
    } else if (this.selected?.rootUri.fsPath !== openRepository.rootUri.fsPath) {
      this.selected = openRepository;
    }

    return this.selected;
  }

  /** Whether the window needs an explicit repository label to distinguish its counts. */
  hasMultipleRepositories() {
    return (this.api?.repositories.length ?? 0) > 1;
  }

  /** @returns {string | undefined} Git executable path, or undefined while Git is unavailable. */
  getGitPath() {
    return this.api?.git.path;
  }

  /** Release all subscriptions; repeated calls have no effect. */
  dispose() {
    if (this.disposed) return;

    this.disposed = true;
    [...this.listeners, ...this.repositoryListeners, ...this.apiListeners].forEach(listener => listener.dispose());
    this.changeListeners.clear();
  }

  /** Activate the built-in extension and subscribe to enablement changes unless disposed. */
  async activateGit() {
    if (this.gitExtension) return;

    const extension = this.vscode.extensions.getExtension(GIT_EXTENSION_ID);
    if (!extension) throw new Error('Git extension unavailable.');

    const gitExtensionExports = extension.isActive ? extension.exports : await extension.activate();
    if (this.disposed) return;

    this.gitExtension = gitExtensionExports;
    if (!this.gitExtension) throw new Error('Git API unavailable.');

    this.listeners.push(this.gitExtension.onDidChangeEnablement(() => {
      this.bindAPI(undefined);
      this.emit(REPOSITORY_CHANGE.ENABLEMENT);
    }));
  }

  /**
   * Replace API and repository subscriptions when Git availability changes.
   * @param {import('./git-api').GitAPI | undefined} api Undefined detaches the current API.
   */
  bindAPI(api) {
    if (this.api === api) return;

    this.apiListeners.splice(0).forEach((listener) => listener.dispose());
    this.repositoryListeners.splice(0).forEach((listener) => listener.dispose());
    this.api = api;
    if (!api) return;

    const handleRepositoriesChanged = () => {
      this.bindRepositories();
      this.resolveRepo();
      this.emit(REPOSITORY_CHANGE.REPOSITORIES);
    };
    this.apiListeners.push(
      api.onDidOpenRepository(handleRepositoriesChanged),
      api.onDidCloseRepository(handleRepositoriesChanged)
    );
    this.bindRepositories();
  }

  /** Rebuild state subscriptions, forwarding changes only for the selected repository. */
  bindRepositories() {
    this.repositoryListeners.splice(0).forEach((listener) => listener.dispose());

    for (const repository of this.api?.repositories ?? []) {
      this.repositoryListeners.push(repository.state.onDidChange(() => {
        if (repository.rootUri.fsPath === this.selected?.rootUri.fsPath) this.emit(REPOSITORY_CHANGE.STATE);
      }));
    }
  }

  /**
   * Notify current subscribers synchronously.
   * @param {RepositoryChange} change
   */
  emit(change) {
    for (const listener of this.changeListeners) listener(change);
  }
}

module.exports = { Repositories };
