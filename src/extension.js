const vscode = require('vscode');
const gitAdapter = require('./adapters/git');
const untrackedFiles = require('./adapters/untrackedFiles');
const { createCollectStats } = require('./core/collectStats');
const { Repositories } = require('./adapters/repositories');
const { StatusBar } = require('./presentation/statusBar');
const { ExtensionController } = require('./presentation/controller');

/** @type {ExtensionController | undefined} */
let activeController;

/**
 * Creates and starts the controller, registering it for disposal by VS Code.
 * @param {import('vscode').ExtensionContext} context
 */
async function activate(context) {
  activeController = new ExtensionController({
    vscode,
    repositories: new Repositories(vscode),
    collectStats: createCollectStats({ git: gitAdapter, files: untrackedFiles }),
    statusBar: new StatusBar(vscode)
  });

  context.subscriptions.push(activeController);
  await activeController.start();
}

/** Releases the controller's resources and clears the active instance. */
function deactivate() {
  activeController?.dispose();
  activeController = undefined;
}

module.exports = { activate, deactivate };
