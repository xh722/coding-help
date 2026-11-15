#!/usr/bin/env node
'use strict';

const { spawnSync } = require('node:child_process');

const REQUIRED_LANGUAGES = ['chi_sim', 'eng'];
const PROBE_TIMEOUT_MS = 3000;

function unavailable(requiredLanguages) {
  return { ok: false, code: 'OCR_UNAVAILABLE', languages: [], missing: [...requiredLanguages] };
}

function runProbe(args, runner) {
  try {
    const result = runner('tesseract', args, {
      shell: false,
      encoding: 'utf8',
      timeout: PROBE_TIMEOUT_MS,
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    if (!result || result.status !== 0 || result.error) return null;
    return typeof result.stdout === 'string' ? result.stdout : '';
  } catch {
    return null;
  }
}

function parseLanguages(output) {
  const languages = new Set();
  for (const line of String(output || '').split(/\r?\n/)) {
    const value = line.trim();
    if (!value || value.startsWith('List of available languages in')) continue;
    if (/^[A-Za-z0-9_.+-]{1,64}$/.test(value)) languages.add(value);
  }
  return [...languages].sort();
}

function inspectEnvironment({ runner = spawnSync, requiredLanguages = REQUIRED_LANGUAGES } = {}) {
  const required = [...requiredLanguages];
  if (!runProbe(['--version'], runner)) return unavailable(required);
  const output = runProbe(['--list-langs'], runner);
  if (output === null) return unavailable(required);
  const languages = parseLanguages(output);
  const missing = required.filter((language) => !languages.includes(language));
  if (missing.length > 0) return { ok: false, code: 'OCR_LANGUAGE_MISSING', languages, missing };
  return { ok: true, code: 'OCR_READY', languages, missing: [] };
}

function main(argv = process.argv.slice(2)) {
  const result = inspectEnvironment();
  if (argv.includes('--json')) {
    process.stdout.write(`${JSON.stringify(result)}\n`);
  } else if (result.ok) {
    process.stdout.write('OCR preflight verified: Tesseract with chi_sim and eng language data is available.\n');
  } else if (result.code === 'OCR_LANGUAGE_MISSING') {
    process.stdout.write(`NOT VERIFIED: missing Tesseract language data: ${result.missing.join(', ')}.\n`);
  } else {
    process.stdout.write('NOT VERIFIED: Tesseract is unavailable. Install tesseract-ocr and its language data.\n');
  }
  return result.ok ? 0 : 2;
}

if (require.main === module) process.exitCode = main();

module.exports = { REQUIRED_LANGUAGES, PROBE_TIMEOUT_MS, inspectEnvironment, parseLanguages, main };
