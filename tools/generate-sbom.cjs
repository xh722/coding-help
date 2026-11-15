'use strict';

const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');
const { execFileSync } = require('node:child_process');

function packageNameFromPath(packagePath) {
  const parts = packagePath.split('/');
  const index = parts.lastIndexOf('node_modules');
  if (index < 0 || index === parts.length - 1) return null;
  const name = parts[index + 1];
  return name.startsWith('@') ? `${name}/${parts[index + 2] || ''}` : name;
}

function purl(name, version) {
  return `pkg:npm/${name.replaceAll('/', '%2F')}@${version}`;
}

function uuidFromHash(hash) {
  return `${hash.slice(0, 8)}-${hash.slice(8, 12)}-4${hash.slice(13, 16)}-${(parseInt(hash.slice(16, 18), 16) & 0x3f | 0x80).toString(16).padStart(2, '0')}${hash.slice(18, 20)}-${hash.slice(20, 32)}`;
}

function resolveDependency(packagePath, dependency, packages) {
  let current = packagePath;
  while (true) {
    const candidate = path.posix.join(current, 'node_modules', dependency);
    if (packages[candidate]) return candidate;
    if (!current) break;
    current = path.posix.dirname(current);
    if (current === '.') current = '';
  }
  const topLevel = path.posix.join('node_modules', dependency);
  return packages[topLevel] ? topLevel : null;
}

function readInputs({ packageJsonPath, packageLockPath }) {
  let packageJson;
  let packageLock;
  try {
    packageJson = JSON.parse(fs.readFileSync(packageJsonPath, 'utf8'));
    packageLock = JSON.parse(fs.readFileSync(packageLockPath, 'utf8'));
  } catch (error) {
    throw new Error(`SBOM input could not be read: ${error.message}`);
  }
  return { packageJson, packageLock };
}

function createSbom({ packageJson, packageLock, sourceRevision }) {
  const root = packageLock?.packages?.[''];
  if (!root || typeof root.name !== 'string' || typeof root.version !== 'string' || !packageLock.packages || typeof packageLock.packages !== 'object') throw new Error('Package lock root package is invalid for SBOM generation.');
  if (!packageJson || packageJson.name !== root.name || packageJson.version !== root.version) throw new Error('Package JSON and lock root do not match for SBOM generation.');
  if (typeof sourceRevision !== 'string' || !sourceRevision) throw new Error('SBOM source revision is required.');

  const entries = Object.entries(packageLock.packages)
    .filter(([packagePath, entry]) => packagePath !== '' && entry && typeof entry.version === 'string' && packageNameFromPath(packagePath))
    .map(([packagePath, entry]) => [packagePath, { ...entry, name: entry.name || packageNameFromPath(packagePath) }])
    .sort(([, left], [, right]) => left.name.localeCompare(right.name) || left.version.localeCompare(right.version));
  const refs = new Map(entries.map(([packagePath, entry]) => [packagePath, purl(entry.name, entry.version)]));
  const components = entries.map(([packagePath, entry]) => {
    const component = { type: 'library', name: entry.name, version: entry.version, purl: refs.get(packagePath), 'bom-ref': refs.get(packagePath), scope: entry.dev ? 'optional' : 'required' };
    if (typeof entry.license === 'string' && entry.license) component.licenses = [{ license: { id: entry.license } }];
    if (typeof entry.integrity === 'string' && entry.integrity.startsWith('sha512-')) component.hashes = [{ alg: 'SHA-512', content: entry.integrity.slice('sha512-'.length) }];
    return component;
  });
  const dependencies = entries.map(([packagePath, entry]) => ({
    ref: refs.get(packagePath),
    dependsOn: Object.keys(entry.dependencies || {}).map((dependency) => refs.get(resolveDependency(packagePath, dependency, packageLock.packages))).filter(Boolean).sort(),
  }));
  const rootRef = `pkg:npm/${root.name}@${root.version}`;
  const rootDependencies = { ...root.dependencies, ...root.devDependencies };
  dependencies.unshift({ ref: rootRef, dependsOn: Object.keys(rootDependencies).map((dependency) => refs.get(resolveDependency('', dependency, packageLock.packages))).filter(Boolean).sort() });
  const body = { bomFormat: 'CycloneDX', specVersion: '1.5', version: 1, metadata: { tools: [{ vendor: 'coding-help', name: 'offline-sbom-generator', version: '1' }], component: { type: 'application', name: root.name, version: root.version, 'bom-ref': rootRef }, properties: [{ name: 'sourceRevision', value: sourceRevision }] }, components, dependencies };
  const digest = crypto.createHash('sha256').update(JSON.stringify(body)).digest('hex');
  return { serialNumber: `urn:uuid:${uuidFromHash(digest)}`, ...body };
}

function writeSbom(outputPath, sbom, fsImpl = fs) {
  const temporaryPath = `${outputPath}.tmp-${process.pid}`;
  fsImpl.mkdirSync(path.dirname(outputPath), { recursive: true });
  try {
    fsImpl.writeFileSync(temporaryPath, `${JSON.stringify(sbom, null, 2)}\n`, { mode: 0o644 });
    fsImpl.renameSync(temporaryPath, outputPath);
  } finally { fsImpl.rmSync(temporaryPath, { force: true }); }
  return outputPath;
}

function generate(outputPath = path.resolve(__dirname, '..', 'dist', 'interviewcoder-local-rebuild.sbom.cdx.json'), repo = path.resolve(__dirname, '..')) {
  const { packageJson, packageLock } = readInputs({ packageJsonPath: path.join(repo, 'package.json'), packageLockPath: path.join(repo, 'package-lock.json') });
  let sourceRevision = 'working-tree';
  try { sourceRevision = execFileSync('git', ['-C', repo, 'rev-parse', 'HEAD'], { encoding: 'utf8' }).trim(); } catch {}
  const sbom = createSbom({ packageJson, packageLock, sourceRevision });
  writeSbom(path.resolve(outputPath), sbom);
  return { output: path.resolve(outputPath), sbom };
}

if (require.main === module) {
  const result = generate(process.argv[2]);
  console.log(`SBOM created: ${result.output}`);
  console.log(`Components: ${result.sbom.components.length}`);
}

module.exports = { createSbom, generate, writeSbom, packageNameFromPath };
