const test = require('node:test');
const assert = require('node:assert/strict');
const { emptyStats } = require('../src/core/stats');
const { ExtensionController } = require('../src/presentation/controller');
const { Repositories } = require('../src/adapters/repositories');
const { StatusBar } = require('../src/presentation/statusBar');

const REFRESH_COMMAND = 'gitWorkingTreeStats.refresh';
const SHOW_OUTPUT_COMMAND = 'gitWorkingTreeStats.showOutput';
const GIT_EXTENSION_ID = 'vscode.git';
const RESOLVED_GIT_PATH = 'resolved-git';

test('editor and repository events update stable items with scoped settings', async (testContext) => {
  testContext.mock.timers.enable({ apis: ['setTimeout'] });
  const context = createExtensionHarness();

  await context.controller.start();
  assert.equal(context.statusBarItems[0].id, 'gitWorkingTreeStats.added');
  assert.equal(context.statusBarItems[0].text, '+2');
  assert.equal(context.statusBarItems[0].tooltip.isTrusted, false);
  assert.match(context.statusBarItems[0].accessibilityInformation.label, /2 lines added/);

  context.vscode.window.activeTextEditor = { document: { uri: { repo: context.secondRepository } } };
  context.editorChanges.fire();
  await flushAutomaticRefresh(testContext);
  assert.equal(context.statusBarItems[0].text, 'B +2');

  context.vscode.window.activeTextEditor = undefined;
  context.editorChanges.fire();
  await flushAutomaticRefresh(testContext);
  assert.equal(context.repositories.selected, context.secondRepository);

  context.gitApi.repositories = [context.firstRepository];
  context.repositoryClosed.fire(context.secondRepository);
  await flushAutomaticRefresh(testContext);
  assert.equal(context.repositories.selected, undefined);
  assert.equal(context.secondRepositoryChanges.listeners.size, 0);

  context.gitApi.repositories = [];
  context.repositoryClosed.fire(context.firstRepository);
  await flushAutomaticRefresh(testContext);
  assert.equal(context.statusBarItems[0].visible, false);

  context.controller.dispose();
  assert.equal(context.firstRepositoryChanges.listeners.size, 0);
  assert.equal(context.editorChanges.listeners.size, 0);
});

test('repository labels follow the active file and unrelated files hide all indicators', async (testContext) => {
  testContext.mock.timers.enable({ apis: ['setTimeout'] });
  const context = createExtensionHarness();
  testContext.after(() => context.controller.dispose());
  await context.controller.start();
  const [added, removed, repository] = context.statusBarItems;
  assert.equal(repository.text, 'a ·');
  assert.equal(repository.visible, true);
  assert.equal(repository.color, undefined);
  assert.equal(repository.tooltip, '/a');

  context.vscode.window.activeTextEditor = { document: { uri: { repo: context.secondRepository } } };
  context.editorChanges.fire();
  assert.ok(context.statusBarItems.every(item => !item.visible));
  await flushAutomaticRefresh(testContext);
  assert.equal(repository.text, 'b ·');
  assert.equal(added.text, 'B +2');
  assert.equal(removed.text, '−0');

  context.vscode.window.activeTextEditor = { document: { uri: {} } };
  context.editorChanges.fire();
  assert.ok(context.statusBarItems.every(item => !item.visible));
  await flushAutomaticRefresh(testContext);
  assert.equal(context.repositories.selected, undefined);
  assert.ok(context.statusBarItems.every(item => !item.visible));

  context.vscode.window.activeTextEditor = undefined;
  context.editorChanges.fire();
  await flushAutomaticRefresh(testContext);
  assert.ok(context.statusBarItems.every(item => !item.visible));

  context.vscode.window.activeTextEditor = { document: { uri: { repo: context.firstRepository } } };
  context.editorChanges.fire();
  await flushAutomaticRefresh(testContext);
  assert.equal(repository.visible, true);

  context.gitApi.repositories = [context.firstRepository];
  context.repositoryClosed.fire(context.secondRepository);
  await flushAutomaticRefresh(testContext);
  assert.equal(repository.visible, false);
  assert.equal(added.visible, true);
  assert.equal(removed.visible, true);

  context.gitApi.repositories.push(context.secondRepository);
  context.repositoryOpened.fire(context.secondRepository);
  await flushAutomaticRefresh(testContext);
  assert.equal(repository.visible, true);
  assert.equal(repository.text, 'a ·');
});

test('fresh Git API wrappers preserve selection and forward repository state changes', async (testContext) => {
  testContext.mock.timers.enable({ apis: ['setTimeout'] });
  let collections = 0;
  const context = createExtensionHarness(async () => ({ ...emptyStats(), added: ++collections }));
  testContext.after(() => context.controller.dispose());
  const repositories = [context.firstRepository, context.secondRepository];
  Object.defineProperty(context.gitApi, 'repositories', {
    get: () => repositories.map(repository => ({ ...repository }))
  });
  context.gitApi.getRepository = uri => uri?.repo ? { ...uri.repo } : null;

  await context.controller.start();
  assert.equal(context.statusBarItems[0].visible, true);
  const selected = context.repositories.selected;
  context.editorChanges.fire();
  await flushAutomaticRefresh(testContext);
  assert.equal(context.repositories.selected, selected);

  const previousCollections = collections;
  context.firstRepositoryChanges.fire();
  await flushAutomaticRefresh(testContext);
  assert.equal(collections, previousCollections + 1);

  context.vscode.window.activeTextEditor = undefined;
  context.editorChanges.fire();
  await flushAutomaticRefresh(testContext);
  assert.equal(context.repositories.selected, selected);

  repositories.shift();
  context.repositoryClosed.fire(context.firstRepository);
  await flushAutomaticRefresh(testContext);
  assert.equal(context.repositories.selected, undefined);
  assert.ok(context.statusBarItems.every(item => !item.visible));
});

test('placement changes replace both items and preserve their content and commands', async (testContext) => {
  testContext.mock.timers.enable({ apis: ['setTimeout'] });
  const context = createExtensionHarness();
  testContext.after(() => context.controller.dispose());
  await context.controller.start();
  const originalItems = [...context.statusBarItems];
  assert.equal(originalItems[0].alignment, context.vscode.StatusBarAlignment.Right);
  assert.equal(originalItems[0].priority, 1000000);
  assert.equal(originalItems[1].priority, 999999);

  const getConfiguration = context.vscode.workspace.getConfiguration;
  context.vscode.workspace.getConfiguration = (section, scope) => ({
    get: (key, fallback) => {
      if (key === 'alignment') return 'left';
      if (key === 'priority') return 10;
      return getConfiguration(section, scope).get(key, fallback);
    }
  });
  context.workspaceEvents.onDidChangeConfiguration.fire({ affectsConfiguration: () => true });
  await flushAutomaticRefresh(testContext);

  assert.ok(originalItems.every(item => item.disposed && !item.visible));
  const replacementItems = context.statusBarItems.slice(3);
  assert.equal(replacementItems.length, 3);
  assert.deepEqual(replacementItems.map(item => item.id), originalItems.map(item => item.id));
  assert.deepEqual(replacementItems.map(item => item.priority), [10, 9, 11]);
  assert.deepEqual(replacementItems.map(item => item.text), ['+2', '−0', 'a ·']);
  assert.ok(replacementItems.every(item => item.visible && item.alignment === context.vscode.StatusBarAlignment.Left));
  assert.ok(replacementItems.every(item => item.command === 'workbench.view.scm'));

  await context.commands.get(REFRESH_COMMAND)();
  assert.equal(context.statusBarItems.length, 6);
});

test('failures replace stale counts and redact unexpected error details', async () => {
  let shouldFail = false;
  const context = createExtensionHarness(async () => {
    if (shouldFail) {
      throw new Error('private contents');
    }

    return { ...emptyStats(), added: 1 };
  });

  await context.controller.start();
  shouldFail = true;
  await context.commands.get(REFRESH_COMMAND)();
  assert.equal(context.statusBarItems[0].text, 'Git stats unavailable');
  assert.equal(context.statusBarItems[1].visible, false);
  assert.equal(context.statusBarItems[0].command, SHOW_OUTPUT_COMMAND);
  assert.equal(context.outputLines.length, 1);
  assert.match(context.outputLines[0], /Unable to refresh stats/);
  assert.ok(!context.outputLines.join('').includes('private contents'));

  shouldFail = false;
  await context.commands.get(REFRESH_COMMAND)();
  assert.equal(context.statusBarItems[0].text, '+1');

  context.controller.dispose();
});

test('Git disabled/re-enabled and activation failure recover without leaked listeners', async () => {
  const context = createExtensionHarness();
  const originalGetExtension = context.vscode.extensions.getExtension;
  context.vscode.extensions.getExtension = () => ({
    isActive: false,
    activate: async () => { throw new Error('secret'); }
  });

  await context.controller.start();
  assert.equal(context.statusBarItems[0].text, 'Git stats unavailable');

  context.vscode.extensions.getExtension = originalGetExtension;
  await context.commands.get(REFRESH_COMMAND)();
  assert.equal(context.statusBarItems[0].text, '+2');

  context.gitExports.enabled = false;
  context.gitEnablement.fire(false);
  await context.commands.get(REFRESH_COMMAND)();
  assert.equal(context.statusBarItems[0].visible, false);
  assert.equal(context.firstRepositoryChanges.listeners.size, 0);

  context.gitExports.enabled = true;
  context.gitEnablement.fire(true);
  await context.commands.get(REFRESH_COMMAND)();
  assert.equal(context.statusBarItems[0].visible, true);
  assert.equal(context.firstRepositoryChanges.listeners.size, 1);

  context.controller.dispose();
  assert.equal(context.gitEnablement.listeners.size, 0);
});

test('restricted workspaces do not activate Git or collect stats', async () => {
  const context = createExtensionHarness(() => assert.fail('must not collect'));
  context.vscode.workspace.isTrusted = false;
  context.vscode.extensions.getExtension = () => assert.fail('must not activate Git');

  await context.controller.start();
  assert.equal(context.statusBarItems[0].visible, false);

  context.controller.dispose();
});

test('repository adapter emits distinct changes and releases every subscription', async () => {
  const context = createExtensionHarness();
  const changes = [];
  context.repositories.onDidChange(change => changes.push(change));
  await context.repositories.ensureGit();
  assert.equal(context.repositories.getGitPath(), RESOLVED_GIT_PATH);
  assert.equal(context.repositories.resolveRepo(), context.firstRepository);

  context.secondRepositoryChanges.fire();
  context.firstRepositoryChanges.fire();
  context.repositoryOpened.fire(context.secondRepository);
  context.gitExports.enabled = false;
  context.gitEnablement.fire(false);
  assert.deepEqual(changes, ['state', 'repositories', 'enablement']);
  assert.equal(context.repositories.getGitPath(), undefined);

  context.repositories.dispose();
  context.repositories.dispose();
  for (const eventSource of [context.repositoryOpened, context.repositoryClosed, context.gitEnablement, context.firstRepositoryChanges, context.secondRepositoryChanges]) {
    assert.equal(eventSource.listeners.size, 0);
  }
  context.statusBar.dispose();
});

test('disposal during Git activation does not attach subscriptions or render', async () => {
  const context = createExtensionHarness(() => assert.fail('collection after disposal'));
  let finishActivation;
  context.vscode.extensions.getExtension = () => ({
    isActive: false,
    activate: () => new Promise(resolve => { finishActivation = resolve; })
  });

  const activation = context.controller.start();
  context.controller.dispose();
  context.controller.dispose();
  finishActivation(context.gitExports);
  await activation;
  assert.equal(context.gitEnablement.listeners.size, 0);
  assert.equal(context.firstRepositoryChanges.listeners.size, 0);
  assert.equal(context.commands.size, 0);
  assert.ok(context.statusBarItems.every(item => item.disposed && !item.visible));
});

test('status bar can recover independently from errors and hide empty results', () => {
  const context = createExtensionHarness();
  context.statusBar.fail(new Error('private details'));
  assert.equal(context.statusBarItems[0].command, SHOW_OUTPUT_COMMAND);
  assert.ok(!context.outputLines.join('').includes('private details'));

  context.statusBar.render({
    repo: context.firstRepository,
    stats: { ...emptyStats(), added: 4, excluded: { 'binary files': 1 } }
  });
  assert.equal(context.statusBarItems[0].text, '+4');
  assert.equal(context.statusBarItems[0].command, 'workbench.view.scm');
  assert.match(context.statusBarItems[0].accessibilityInformation.label, /partial totals/);
  assert.equal(context.statusBarItems[0].tooltip.supportHtml, false);
  assert.equal(context.statusBarItems[0].tooltip.supportThemeIcons, false);

  context.statusBar.render(undefined);
  assert.ok(context.statusBarItems.every(item => !item.visible));

  context.controller.dispose();
});

test('workspace triggers refresh automatically and ignore unrelated changes', async (testContext) => {
  testContext.mock.timers.enable({ apis: ['setTimeout'] });
  let collections = 0;
  const context = createExtensionHarness(async () => ({ ...emptyStats(), added: ++collections }));
  testContext.after(() => context.controller.dispose());
  await context.controller.start();

  const triggers = [
    ['onDidSaveTextDocument'], ['onDidCreateFiles'], ['onDidDeleteFiles'], ['onDidRenameFiles'],
    ['onDidChangeWindowState', { focused: true }],
    ['onDidChangeConfiguration', { affectsConfiguration: key => key === 'gitWorkingTreeStats' }],
    ['onDidChangeConfiguration', { affectsConfiguration: key => key === 'git.enabled' }]
  ];

  for (const [eventName, event] of triggers) {
    const previousCollections = collections;
    context.workspaceEvents[eventName].fire(event);
    await flushAutomaticRefresh(testContext);
    assert.equal(collections, previousCollections + 1, eventName);
    assert.equal(context.statusBarItems[0].text, `+${collections}`, eventName);
  }

  const previousCollections = collections;
  context.workspaceEvents.onDidChangeWindowState.fire({ focused: false });
  context.workspaceEvents.onDidChangeConfiguration.fire({ affectsConfiguration: () => false });
  await flushAutomaticRefresh(testContext);
  assert.equal(collections, previousCollections);

  context.controller.dispose();
  for (const event of Object.values(context.workspaceEvents)) {
    assert.equal(event.listeners.size, 0);
  }
});

/** Advance the debounce deadline and let asynchronous collection finish without a manual refresh. */
async function flushAutomaticRefresh(testContext) {
  testContext.mock.timers.tick(400);
  await new Promise(resolve => setImmediate(resolve));
}

/**
 * Builds a VS Code double with observable UI state and disposable event listeners.
 * @param {Function} collectStats Optional collector used to simulate results or failures.
 */
function createExtensionHarness(collectStats = async () => ({ ...emptyStats(), added: 2 })) {
  const editorChanges = createEventSource();
  const repositoryOpened = createEventSource();
  const repositoryClosed = createEventSource();
  const gitEnablement = createEventSource();
  const firstRepositoryChanges = createEventSource();
  const secondRepositoryChanges = createEventSource();
  const statusBarItems = [];
  const outputLines = [];
  const commands = new Map();

  const firstRepository = {
    rootUri: { fsPath: '/a' },
    state: { onDidChange: firstRepositoryChanges.on }
  };
  const secondRepository = {
    rootUri: { fsPath: '/b' },
    state: { onDidChange: secondRepositoryChanges.on }
  };
  const gitApi = {
    git: { path: RESOLVED_GIT_PATH },
    repositories: [firstRepository, secondRepository],
    getRepository: uri => uri?.repo ?? null,
    onDidOpenRepository: repositoryOpened.on,
    onDidCloseRepository: repositoryClosed.on
  };
  const gitExports = {
    enabled: true,
    onDidChangeEnablement: gitEnablement.on,
    getAPI: () => gitApi
  };
  const workspaceEvents = Object.fromEntries([
    'onDidSaveTextDocument', 'onDidCreateFiles', 'onDidDeleteFiles',
    'onDidRenameFiles', 'onDidChangeConfiguration', 'onDidChangeWindowState'
  ].map(name => [name, createEventSource()]));

  const vscode = {
    StatusBarAlignment: { Left: 1, Right: 2 },
    MarkdownString: class {
      constructor(value) {
        this.value = value;
      }
    },
    commands: {
      registerCommand: (id, callback) => {
        commands.set(id, callback);
        return { dispose: () => commands.delete(id) };
      }
    },
    extensions: {
      getExtension: id => {
        assert.equal(id, GIT_EXTENSION_ID);
        return { isActive: true, exports: gitExports };
      }
    },
    window: {
      activeTextEditor: { document: { uri: { repo: firstRepository } } },
      onDidChangeActiveTextEditor: editorChanges.on,
      onDidChangeWindowState: workspaceEvents.onDidChangeWindowState.on,
      createOutputChannel: () => ({
        appendLine: line => outputLines.push(line),
        show() {},
        dispose() {}
      }),
      createStatusBarItem: (id, alignment, priority) => {
        const item = {
          id, alignment, priority,
          visible: false,
          show() { this.visible = true; },
          hide() { this.visible = false; },
          dispose() { this.disposed = true; this.visible = false; }
        };
        statusBarItems.push(item);
        return item;
      }
    },
    workspace: {
      isTrusted: true,
      onDidSaveTextDocument: workspaceEvents.onDidSaveTextDocument.on,
      onDidCreateFiles: workspaceEvents.onDidCreateFiles.on,
      onDidDeleteFiles: workspaceEvents.onDidDeleteFiles.on,
      onDidRenameFiles: workspaceEvents.onDidRenameFiles.on,
      onDidChangeConfiguration: workspaceEvents.onDidChangeConfiguration.on,
      getConfiguration: (_key, scope) => {
        return {
          get: (key, fallback) => key === 'addedPrefix' && scope === secondRepository.rootUri ? 'B' : fallback
        };
      }
    }
  };

  const repositories = new Repositories(vscode);
  const statusBar = new StatusBar(vscode);
  const controller = new ExtensionController({ vscode, repositories, statusBar, collectStats });

  return {
    controller, repositories, statusBar, vscode, gitApi, gitExports,
    statusBarItems, outputLines, commands, workspaceEvents, firstRepository, secondRepository,
    editorChanges, repositoryOpened, repositoryClosed, gitEnablement,
    firstRepositoryChanges, secondRepositoryChanges
  };
}

/** Tracks subscriptions and fires a snapshot so listeners can unsubscribe during delivery. */
function createEventSource() {
  const listeners = new Set();

  return {
    on: listener => {
      listeners.add(listener);
      return { dispose: () => listeners.delete(listener) };
    },
    fire: value => [...listeners].forEach(listener => listener(value)),
    listeners
  };
}
