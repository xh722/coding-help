'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { createSbom } = require('../tools/generate-sbom.cjs');

function lockFixture() {
  return {
    lockfileVersion: 3,
    packages: {
      '': { name: 'interviewcoder-local-rebuild', version: '0.1.0', dependencies: { alpha: '^1.0.0' }, devDependencies: { beta: '^2.0.0' } },
      'node_modules/alpha': { version: '1.2.3', license: 'MIT', integrity: 'sha512-alpha' },
      'node_modules/beta': { version: '2.3.4', license: 'ISC', dev: true },
    },
  };
}

test('SBOM is deterministic and includes package lock components and source revision', () => {
  const options = { packageJson: { name: 'interviewcoder-local-rebuild', version: '0.1.0' }, packageLock: lockFixture(), sourceRevision: 'a'.repeat(40) };
  const first = createSbom(options);
  const second = createSbom(options);
  assert.deepEqual(first, second);
  assert.equal(first.bomFormat, 'CycloneDX');
  assert.equal(first.specVersion, '1.5');
  assert.deepEqual(first.metadata.component, { type: 'application', name: 'interviewcoder-local-rebuild', version: '0.1.0', 'bom-ref': 'pkg:npm/interviewcoder-local-rebuild@0.1.0' });
  assert.deepEqual(first.metadata.properties, [{ name: 'sourceRevision', value: 'a'.repeat(40) }]);
  assert.deepEqual(first.components.map((component) => [component.name, component.version]), [['alpha', '1.2.3'], ['beta', '2.3.4']]);
  assert.equal(first.components[0].purl, 'pkg:npm/alpha@1.2.3');
});

test('SBOM rejects package locks without a valid root package', () => {
  assert.throws(() => createSbom({ packageJson: { name: 'x', version: '1.0.0' }, packageLock: { packages: {} }, sourceRevision: 'a'.repeat(40) }), /package lock/i);
});
