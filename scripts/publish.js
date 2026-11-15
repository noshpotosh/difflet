const { spawnSync } = require('node:child_process');
const { verify } = require('./verify-package');
const { PACKAGE_PATH } = require('./package-config');

const OIDC_FLAG = '--oidc';

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
  const options = process.argv.slice(3);
  const useOidc = options.length === 1 && options[0] === OIDC_FLAG && registryName === 'marketplace';
  if (options.length && !useOidc) {
    throw new Error('Only marketplace supports the --oidc publishing option.');
  }
  if (useOidc && process.env.VSCE_PAT) {
    throw new Error('Remove VSCE_PAT when using trusted publishing.');
  }
  if (!useOidc && !process.env[registry.tokenVariable]) {
    throw new Error(`Set ${registry.tokenVariable} to a publishing token before publishing to ${registryName}.`);
  }

  await verify();

  const result = spawnSync('npx', ['--no-install', ...registry.args, ...(useOidc ? [OIDC_FLAG] : [])], {
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
