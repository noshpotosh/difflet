const fs = require('node:fs/promises');
const path = require('node:path');
const os = require('node:os');
const { execFileSync, spawn } = require('node:child_process');
const { PACKAGE_DIRECTORY, PACKAGE_PATH } = require('./package-config');

const PREVIEW_PATH_FILE = path.join(PACKAGE_DIRECTORY, 'preview-path.txt');
const DEMO_FILENAME = 'welcome.js';

/** Launch an isolated VS Code demo and retain its temporary files for the preview session. */
async function launchPreview() {
  const vscodeLauncher = process.env.VSCODE_CLI;
  if (!vscodeLauncher) {
    throw new Error('Set VSCODE_CLI to the VS Code command-line launcher.');
  }

  const temporaryRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'git-stats-preview-'));
  const workspacePath = path.join(temporaryRoot, 'git-stats-demo');
  await createDemoWorkspace(workspacePath);

  const userDataPath = path.join(temporaryRoot, 'user-data');
  await writePreviewSettings(userDataPath);

  const profileArguments = [
    '--user-data-dir', userDataPath,
    '--extensions-dir', path.join(temporaryRoot, 'extensions')
  ];
  execFileSync(vscodeLauncher, [
    ...profileArguments, '--install-extension', path.resolve(PACKAGE_PATH), '--force'
  ], { stdio: 'inherit' });

  const previewProcess = spawn(vscodeLauncher, [
    ...profileArguments,
    '--new-window',
    '--disable-workspace-trust',
    '--skip-welcome',
    workspacePath,
    path.join(workspacePath, DEMO_FILENAME)
  ], { detached: true, stdio: 'ignore' });
  previewProcess.unref();

  await fs.mkdir(PACKAGE_DIRECTORY, { recursive: true });
  await fs.writeFile(PREVIEW_PATH_FILE, temporaryRoot + '\n');
  console.log(`Isolated preview: ${temporaryRoot}`);
}

/** Commit a baseline, then create tracked and untracked changes for the statistics demo. */
async function createDemoWorkspace(workspacePath) {
  await fs.mkdir(workspacePath);

  const runGit = (...arguments_) => execFileSync('git', arguments_, {
    cwd: workspacePath,
    stdio: 'pipe'
  });
  runGit('init', '-b', 'main');
  runGit('config', 'user.name', 'Preview');
  runGit('config', 'user.email', 'preview@example.invalid');

  const demoFilePath = path.join(workspacePath, DEMO_FILENAME);
  await fs.writeFile(demoFilePath, "function welcome(name) {\n  console.log('Hello ' + name);\n}\n\nwelcome('world');\n");
  runGit('add', '.');
  runGit('-c', 'commit.gpgsign=false', 'commit', '-m', 'Preview baseline');

  await fs.writeFile(demoFilePath, "function welcome(name = 'world') {\n  return `Hello, ${name}!`;\n}\n\nconsole.log(welcome());\nconsole.log(welcome('Git stats'));\n");
  await fs.writeFile(path.join(workspacePath, 'notes.md'), '# Release notes\n\nCounts reflect saved changes against HEAD.\n');
}

/** Configure the temporary VS Code profile used by the preview. */
async function writePreviewSettings(userDataPath) {
  await fs.mkdir(path.join(userDataPath, 'User'), { recursive: true });
  await fs.writeFile(path.join(userDataPath, 'User/settings.json'), JSON.stringify({
    'workbench.colorTheme': 'Default Dark Modern',
    'workbench.startupEditor': 'none',
    'window.title': 'Difflet — Preview',
    'chat.disableAIFeatures': true,
    'telemetry.telemetryLevel': 'off',
    'git.openRepositoryInParentFolders': 'never'
  }));
}

launchPreview().catch(error => {
  console.error(error);
  process.exitCode = 1;
});
