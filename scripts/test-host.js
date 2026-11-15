const path = require('node:path');
const os = require('node:os');
const fs = require('node:fs/promises');
const { execFileSync } = require('node:child_process');
const { runTests } = require('@vscode/test-electron');
const yauzl = require('yauzl');
const { verify } = require('./verify-package');
const { PACKAGE_PATH } = require('./package-config');

const PACKAGE_TEST_FLAG = '--package';
const DEFAULT_VSCODE_VERSION = 'stable';

/** Run source or packaged extension tests in an isolated workspace, then remove it. */
async function runHostTests() {
  // Git resolves symlinks, so VS Code must open the same canonical workspace path.
  const temporaryDirectory = await fs.realpath(os.tmpdir());
  const temporaryRoot = await fs.mkdtemp(path.join(temporaryDirectory, 'git-stats-host-'));

  try {
    const workspacePath = path.join(temporaryRoot, 'workspace');
    await fs.mkdir(workspacePath);
    execFileSync('git', ['init'], { cwd: workspacePath });
    await fs.writeFile(path.join(workspacePath, 'example.txt'), 'one\ntwo\n');

    let extensionDevelopmentPath = path.resolve(__dirname, '..');
    if (process.argv.includes(PACKAGE_TEST_FLAG)) {
      const packageDirectory = path.join(temporaryRoot, 'package');
      await extractPackage(packageDirectory);
      extensionDevelopmentPath = path.join(packageDirectory, 'extension');
    }

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

/** Verify the local VSIX and extract its files beneath the supplied directory. */
async function extractPackage(destination) {
  await verify();

  await new Promise((resolve, reject) => {
    yauzl.open(PACKAGE_PATH, { lazyEntries: true }, (error, archive) => {
      if (error) return reject(error);

      archive.on('error', reject);
      archive.on('end', resolve);
      archive.on('entry', entry => {
        archive.openReadStream(entry, (error, stream) => {
          if (error) return reject(error);

          const chunks = [];
          stream.on('error', reject);
          stream.on('data', chunk => chunks.push(chunk));
          stream.on('end', async () => {
            try {
              const filePath = path.join(destination, entry.fileName);
              await fs.mkdir(path.dirname(filePath), { recursive: true });
              await fs.writeFile(filePath, Buffer.concat(chunks));
              archive.readEntry();
            } catch (error) {
              reject(error);
            }
          });
        });
      });
      archive.readEntry();
    });
  });
}

runHostTests().catch(error => {
  console.error(error);
  process.exitCode = 1;
});
