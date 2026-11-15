const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const path = require('node:path');
const vscode = require('vscode');

const EXTENSION_ID = 'Noshpotosh.difflet';
const GIT_EXTENSION_ID = 'vscode.git';
const REFRESH_COMMAND = 'gitWorkingTreeStats.refresh';
const SHOW_OUTPUT_COMMAND = 'gitWorkingTreeStats.showOutput';
const FIXTURE_FILENAME = 'example.txt';

/**
 * Checks activation and saved-file counting in the temporary workspace supplied by the host runner.
 * Edits, saves, and deletes the fixture document in that workspace.
 */
exports.run = async function runHostSmokeTests() {
  const extension = vscode.extensions.getExtension(EXTENSION_ID);
  assert.ok(extension);
  await extension.activate();
  assert.equal(extension.isActive, true);

  const { createCollectStats } = require(path.join(extension.extensionPath, 'src/core/collectStats'));
  const gitOperations = require(path.join(extension.extensionPath, 'src/adapters/git'));
  const fileOperations = require(path.join(extension.extensionPath, 'src/adapters/untrackedFiles'));
  const collectStats = createCollectStats({ git: gitOperations, files: fileOperations });

  const commands = await vscode.commands.getCommands(true);
  assert.ok(commands.includes(REFRESH_COMMAND));
  assert.ok(commands.includes(SHOW_OUTPUT_COMMAND));

  const gitExtension = vscode.extensions.getExtension(GIT_EXTENSION_ID);
  const gitApi = (await gitExtension.activate()).getAPI(1);
  const repositoryRoot = process.env.GIT_STATS_HOST_ROOT;
  await gitApi.openRepository(vscode.Uri.file(repositoryRoot));

  const document = await vscode.workspace.openTextDocument(path.join(repositoryRoot, FIXTURE_FILENAME));
  await vscode.window.showTextDocument(document);
  const { Repositories } = require(path.join(extension.extensionPath, 'src/adapters/repositories'));
  const repositories = new Repositories(vscode);
  try {
    await repositories.ensureGit();
    assert.equal(repositories.resolveRepo()?.rootUri.fsPath, gitApi.getRepository(document.uri).rootUri.fsPath);
    const selected = repositories.selected;
    assert.equal(repositories.resolveRepo(), selected);
  } finally {
    repositories.dispose();
  }

  await vscode.commands.executeCommand(REFRESH_COMMAND);
  assert.equal((await collectStats(gitApi.git.path, repositoryRoot, true)).added, 2);

  const edit = new vscode.WorkspaceEdit();
  edit.insert(document.uri, new vscode.Position(2, 0), 'unsaved\n');
  assert.equal(await vscode.workspace.applyEdit(edit), true);
  assert.equal(document.isDirty, true);
  assert.equal((await collectStats(gitApi.git.path, repositoryRoot, true)).added, 2);

  assert.equal(await document.save(), true);
  await vscode.commands.executeCommand(REFRESH_COMMAND);
  assert.equal((await collectStats(gitApi.git.path, repositoryRoot, true)).added, 3);

  await vscode.commands.executeCommand(SHOW_OUTPUT_COMMAND);
  await fs.unlink(path.join(repositoryRoot, FIXTURE_FILENAME));
  await vscode.commands.executeCommand(REFRESH_COMMAND);
  const afterDeletion = await collectStats(gitApi.git.path, repositoryRoot, true);
  assert.equal(afterDeletion.added, 0);
  assert.deepEqual(afterDeletion.files, []);
  console.log('Extension host smoke checks passed.');
};
