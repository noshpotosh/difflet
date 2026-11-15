const path = require('node:path');
const fs = require('node:fs/promises');
const { createVSIX } = require('@vscode/vsce');
const { verify } = require('./verify-package');
const { PACKAGE_DIRECTORY, PACKAGE_PATH } = require('./package-config');

/** Build the release package, then verify its contents and write its checksum. */
async function buildPackage() {
  await fs.mkdir(PACKAGE_DIRECTORY, { recursive: true });
  await createVSIX({
    cwd: path.resolve(__dirname, '..'),
    packagePath: PACKAGE_PATH,
    // README links are absolute so they render the same on GitHub, the Marketplace, and Open VSX.
    rewriteRelativeLinks: false,
    dependencies: false
  });

  await verify();
}

buildPackage().catch(error => {
  console.error(error);
  process.exitCode = 1;
});
