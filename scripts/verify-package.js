const yauzl = require('yauzl');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const crypto = require('node:crypto');
const { PACKAGE_VERSION, PACKAGE_FILENAME, PACKAGE_PATH } = require('./package-config');

const RUNTIME_FILES = [
  'src/adapters/git.js',
  'src/adapters/repositories.js',
  'src/adapters/untrackedFiles.js',
  'src/core/collectStats.js',
  'src/core/refreshQueue.js',
  'src/core/stats.js',
  'src/extension.js',
  'src/presentation/constants.js',
  'src/presentation/controller.js',
  'src/presentation/formatting.js',
  'src/presentation/statusBar.js'
];
const REQUIRED_FILES = [
  'package.json', ...RUNTIME_FILES, 'LICENSE', 'README.md', 'CHANGELOG.md', 'media/icon.png'
];
const PACKAGED_FILENAMES = {
  LICENSE: 'LICENSE.txt',
  'README.md': 'readme.md',
  'CHANGELOG.md': 'changelog.md'
};
const VSIX_MANIFEST_PATH = 'extension.vsixmanifest';
const EXTENSION_MANIFEST_PATH = 'extension/package.json';
const SCREENSHOT_PATH_PATTERN = /^extension\/media\/screenshot[^/]*\.png$/;

/** Assert package contents match local sources and stable release metadata, then write a SHA-256 sidecar. */
async function verify() {
  const entries = await readPackageEntries();
  const allowedPaths = new Set([
    '[Content_Types].xml',
    VSIX_MANIFEST_PATH,
    ...REQUIRED_FILES.map(getPackagedPath)
  ]);

  for (const entryPath of entries.keys()) {
    assert.ok(
      allowedPaths.has(entryPath) || SCREENSHOT_PATH_PATTERN.test(entryPath),
      `Unexpected packaged file: ${entryPath}`
    );
  }

  for (const sourcePath of REQUIRED_FILES) {
    const packagedPath = getPackagedPath(sourcePath);
    assert.ok(entries.has(packagedPath), `Missing ${sourcePath}`);
    assert.ok(
      entries.get(packagedPath).equals(await fs.readFile(sourcePath)),
      `Packaged file differs: ${sourcePath}`
    );
  }

  const vsixManifest = entries.get(VSIX_MANIFEST_PATH).toString();
  assert.doesNotMatch(vsixManifest, /Microsoft\.VisualStudio\.Code\.PreRelease[^>]*Value="true"/);

  const extensionManifest = JSON.parse(entries.get(EXTENSION_MANIFEST_PATH));
  assert.equal(extensionManifest.version, PACKAGE_VERSION);
  assert.equal(extensionManifest.main, './src/extension.js');

  const checksum = crypto.createHash('sha256').update(await fs.readFile(PACKAGE_PATH)).digest('hex');
  await fs.writeFile(`${PACKAGE_PATH}.sha256`, `${checksum}  ${PACKAGE_FILENAME}\n`);
  console.log(`Verified ${entries.size} package entries. SHA-256: ${checksum}`);
}

/** Read the VSIX sequentially into a map of archive paths to file buffers. */
async function readPackageEntries() {
  const entries = new Map();

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
          stream.on('end', () => {
            entries.set(entry.fileName, Buffer.concat(chunks));
            archive.readEntry();
          });
        });
      });
      archive.readEntry();
    });
  });

  return entries;
}

/** Apply VSCE's documentation filename changes and extension directory prefix. */
function getPackagedPath(sourcePath) {
  return `extension/${PACKAGED_FILENAMES[sourcePath] || sourcePath}`;
}

if (require.main === module) {
  verify().catch(error => {
    console.error(error);
    process.exitCode = 1;
  });
}

module.exports = { verify };
