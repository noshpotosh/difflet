const path = require('node:path');
const { name, version } = require('../package.json');

const PACKAGE_VERSION = version;
const PACKAGE_FILENAME = `${name}-${PACKAGE_VERSION}.vsix`;
const PACKAGE_DIRECTORY = 'dist';
const PACKAGE_PATH = path.join(PACKAGE_DIRECTORY, PACKAGE_FILENAME);

module.exports = { PACKAGE_VERSION, PACKAGE_FILENAME, PACKAGE_DIRECTORY, PACKAGE_PATH };
