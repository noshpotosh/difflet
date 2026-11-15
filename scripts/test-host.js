const path = require('node:path');
const os = require('node:os');
const fs = require('node:fs/promises');
const { execFileSync } = require('node:child_process');
const { runTests } = require('@vscode/test-electron');

const DEFAULT_VSCODE_VERSION = 'stable';

/** Run source or packaged extension tests in an isolated workspace, then remove it. */
async function runHostTests() {
  const temporaryRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'git-stats-host-'));

  try {
    const workspacePath = path.join(temporaryRoot, 'workspace');
    await fs.mkdir(workspacePath);
    execFileSync('git', ['init'], { cwd: workspacePath });
    await fs.writeFile(path.join(workspacePath, 'example.txt'), 'one\ntwo\n');

    const extensionDevelopmentPath = path.resolve(__dirname, '..');

    await runTests({
      version: process.env.VSCODE_VERSION || DEFAULT_VSCODE_VERSION,
      vscodeExecutablePath: process.env.VSCODE_EXECUTABLE_PATH || undefined,
      extensionDevelopmentPath,
      extensionTestsPath: path.resolve(__dirname, '../test/host/index.js'),
      launchArgs: [
        workspacePath,
        '--disable-extensions',
        '--skip-welcome',
        '--skip-release-notes',
        '--disable-workspace-trust',
        '--user-data-dir', path.join(temporaryRoot, 'user-data'),
        '--extensions-dir', path.join(temporaryRoot, 'extensions')
      ],
      extensionTestsEnv: { GIT_STATS_HOST_ROOT: workspacePath }
    });
  } finally {
    await fs.rm(temporaryRoot, { recursive: true, force: true });
  }
}

runHostTests().catch(error => {
  console.error(error);
  process.exitCode = 1;
});
