'use strict';

const { createUpdateManager } = require('../packages/core/update.cjs');

function main(args = process.argv.slice(2), env = process.env) {
  const [installRoot, manifestPath, signaturePath, archivePath] = args;
  if (!installRoot) throw new Error('Usage: node tools/apply-update.cjs <install-root> <manifest> <signature> <archive> | --rollback <install-root>');
  const manager = createUpdateManager({ installRoot: installRoot === '--rollback' ? args[1] : installRoot, gpgHome: env.CODING_HELP_GPG_HOME, publicKeyPath: env.CODING_HELP_UPDATE_PUBLIC_KEY, trustedFingerprint: env.CODING_HELP_UPDATE_FINGERPRINT });
  if (installRoot === '--rollback') return manager.rollback();
  if (!manifestPath || !signaturePath || !archivePath) throw new Error('Usage: node tools/apply-update.cjs <install-root> <manifest> <signature> <archive>');
  return manager.applyUpdate({ manifestPath, signaturePath, archivePath });
}

if (require.main === module) console.log(`Update active version: ${main()}`);

module.exports = { main };
