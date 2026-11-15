const { spawnSync } = require('node:child_process');
const { verify } = require('./verify-package');
const { PACKAGE_PATH } = require('./package-config');

/** Publish commands for each registry. Each CLI reads its token from the named environment variable. */
const REGISTRY_COMMANDS = {
  marketplace: { tokenVariable: 'VSCE_PAT', args: ['vsce', 'publish', '--packagePath', PACKAGE_PATH] },
  openvsx: { tokenVariable: 'OVSX_PAT', args: ['ovsx', 'publish', PACKAGE_PATH] }
};

/**
 * Verify the already-built VSIX, then publish that exact file to the registry named on the command line.
 * Run `npm run package` and the release checks first; this script never rebuilds the package.
 */
async function publishPackage() {
  const registryName = process.argv[2];
  const registry = REGISTRY_COMMANDS[registryName];
  if (!registry) {
    throw new Error(`Usage: node scripts/publish.js <${Object.keys(REGISTRY_COMMANDS).join('|')}>`);
  }
  if (!process.env[registry.tokenVariable]) {
    throw new Error(`Set ${registry.tokenVariable} to a publishing token before publishing to ${registryName}.`);
  }

  await verify();

  const result = spawnSync('npx', ['--no-install', ...registry.args], {
    stdio: 'inherit',
    shell: process.platform === 'win32'
  });
  if (result.status !== 0) {
    throw new Error(`Publishing to ${registryName} failed with exit code ${result.status}.`);
  }
}

publishPackage().catch(error => {
  console.error(error.message);
  process.exitCode = 1;
});
