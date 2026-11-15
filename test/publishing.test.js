const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const { PACKAGE_PATH } = require('../scripts/package-config');

const publishingScript = fs.readFileSync(path.join(__dirname, '../scripts/publish.js'), 'utf8');

test('Marketplace OIDC verifies and publishes the existing VSIX without a PAT', async () => {
  const result = await runPublishing(['marketplace', '--oidc']);
  assert.equal(result.process.exitCode, undefined);
  assert.deepEqual(result.calls, ['verify', ['npx', '--no-install', 'vsce', 'publish', '--packagePath', PACKAGE_PATH, '--oidc']]);
});

test('token-based publishing remains available for both registries', async () => {
  for (const [registry, token, command] of [
    ['marketplace', 'VSCE_PAT', ['vsce', 'publish', '--packagePath', PACKAGE_PATH]],
    ['openvsx', 'OVSX_PAT', ['ovsx', 'publish', PACKAGE_PATH]]
  ]) {
    const result = await runPublishing([registry], { [token]: 'test-token' });
    assert.equal(result.process.exitCode, undefined);
    assert.deepEqual(result.calls, ['verify', ['npx', '--no-install', ...command]]);
  }
});

test('invalid authentication and unsupported options fail before verification or upload', async () => {
  for (const [args, env] of [
    [['marketplace'], {}],
    [['marketplace', '--oidc'], { VSCE_PAT: 'test-token' }],
    [['openvsx', '--oidc'], {}],
    [['marketplace', '--unknown'], {}],
    [['unknown'], {}]
  ]) {
    const result = await runPublishing(args, env);
    assert.equal(result.process.exitCode, 1);
    assert.deepEqual(result.calls, []);
    assert.equal(result.errors.length, 1);
  }
});

test('package verification failure prevents uploading', async () => {
  const result = await runPublishing(['marketplace', '--oidc'], {}, { verificationFails: true });
  assert.equal(result.process.exitCode, 1);
  assert.deepEqual(result.calls, ['verify']);
});

test('registry CLI failure fails the publishing command', async () => {
  const result = await runPublishing(['marketplace', '--oidc'], {}, { status: 1 });
  assert.equal(result.process.exitCode, 1);
  assert.match(result.errors[0], /failed with exit code 1/);
});

/** Execute the CLI with isolated environment and fake verification/upload dependencies. */
async function runPublishing(args, env = {}, { verificationFails = false, status = 0 } = {}) {
  const calls = [];
  const errors = [];
  const fakeProcess = { argv: ['node', 'publish.js', ...args], env, platform: 'linux' };
  vm.runInNewContext(publishingScript, {
    process: fakeProcess,
    console: { error: message => errors.push(message) },
    require(name) {
      if (name === './package-config') return { PACKAGE_PATH };
      if (name === './verify-package') return { verify: async () => {
        calls.push('verify');
        if (verificationFails) throw new Error('Package differs');
      } };
      if (name === 'node:child_process') return { spawnSync: (command, arguments_) => {
        calls.push([command, ...arguments_]);
        return { status };
      } };
      throw new Error(`Unexpected dependency: ${name}`);
    }
  });
  await new Promise(resolve => setImmediate(resolve));
  return { process: fakeProcess, calls, errors };
}
