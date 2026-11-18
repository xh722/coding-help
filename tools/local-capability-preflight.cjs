'use strict';

const path = require('node:path');
const { spawnSync } = require('node:child_process');
const { inspectEnvironment: inspectOcr } = require('./screen-ocr-preflight.cjs');

const REPO_ROOT = path.resolve(__dirname, '..');
const PROBE_TIMEOUT_MS = 5000;
const DEEP_VERIFY_TIMEOUT_MS = 15000;
const SAFE_AUDIO_REASONS = new Set(['audio input detected', 'audio probe unavailable', 'no audio input device detected']);
const SAFE_ASR_MESSAGES = new Set([
  'model path is required',
  'model path is missing',
  'model path is not a directory',
  'faster-whisper is not installed',
  'faster-whisper model could not be loaded',
  'cpu thread count is invalid',
]);

function failedProbe() {
  return { ok: false, code: 'CAPABILITY_PROBE_FAILED' };
}

function runJsonCommand(command, args, { runner = spawnSync, cwd = REPO_ROOT, timeoutMs = PROBE_TIMEOUT_MS } = {}) {
  try {
    const result = runner(command, args, {
      cwd,
      encoding: 'utf8',
      timeout: timeoutMs,
      shell: false,
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    if (!result || result.error || typeof result.stdout !== 'string') return failedProbe();
    const value = JSON.parse(result.stdout);
    return value && typeof value === 'object' && !Array.isArray(value) ? value : failedProbe();
  } catch {
    return failedProbe();
  }
}

function runJsonProbe(command, args, options = {}) {
  return runJsonCommand(command, args, { ...options, timeoutMs: PROBE_TIMEOUT_MS });
}

function inspectUpdateTools({ runner = spawnSync } = {}) {
  const probe = (command) => {
    try {
      const result = runner(command, ['--version'], {
        encoding: 'utf8',
        timeout: PROBE_TIMEOUT_MS,
        shell: false,
        stdio: ['ignore', 'pipe', 'pipe'],
      });
      return Boolean(result && !result.error && result.status === 0);
    } catch {
      return false;
    }
  };
  const tools = { gpg: probe('gpg'), tar: probe('tar') };
  return tools.gpg && tools.tar
    ? { ok: true, code: 'UPDATE_TOOLS_READY', tools }
    : { ok: false, code: 'UPDATE_TOOLS_MISSING', tools };
}

function sanitizeProbe(name, value) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return failedProbe();
  const ok = value.ok === true;
  if (name === 'ocr') {
    const languages = Array.isArray(value.languages) ? value.languages.filter((language) => typeof language === 'string' && /^[A-Za-z0-9_.+-]{1,64}$/.test(language)).slice(0, 64) : [];
    const missing = Array.isArray(value.missing) ? value.missing.filter((language) => typeof language === 'string' && /^[A-Za-z0-9_.+-]{1,64}$/.test(language)).slice(0, 16) : [];
    const code = ['OCR_READY', 'OCR_UNAVAILABLE', 'OCR_LANGUAGE_MISSING'].includes(value.code) ? value.code : 'CAPABILITY_PROBE_FAILED';
    return { ok, code, languages, missing };
  }
  if (name === 'audio') {
    const safeReason = SAFE_AUDIO_REASONS.has(value.reason) ? value.reason : 'audio probe unavailable';
    const count = (entry) => Number.isSafeInteger(entry?.cards) ? Math.max(0, entry.cards) : Number.isSafeInteger(entry?.sources) ? Math.max(0, entry.sources) : 0;
    return {
      ok,
      code: ok ? 'AUDIO_READY' : 'AUDIO_UNAVAILABLE',
      reason: safeReason,
      alsa: { cards: count(value.alsa) },
      pulse: { sources: count(value.pulse) },
      display: { available: value.display?.available === true },
    };
  }
  if (name === 'asr') {
    const code = typeof value.code === 'string' && /^ASR_[A-Z0-9_]+$/.test(value.code) ? value.code : 'ASR_RUNTIME_UNAVAILABLE';
    const message = SAFE_ASR_MESSAGES.has(value.message) ? value.message : 'ASR runtime is unavailable.';
    return { ok, code, message };
  }
  if (name === 'update') {
    return {
      ok,
      code: value.code === 'UPDATE_TOOLS_READY' ? value.code : 'UPDATE_TOOLS_MISSING',
      tools: { gpg: value.tools?.gpg === true, tar: value.tools?.tar === true },
    };
  }
  return failedProbe();
}

function statusFor(name, value) {
  if (value.ok) return 'ready';
  if (name === 'asr' && ['ASR_MODEL_MISSING', 'ASR_MODEL_INVALID', 'ASR_DEPENDENCY_MISSING', 'ASR_INVALID_CONFIG'].includes(value.code)) return 'needs_configuration';
  return 'unavailable';
}

function sanitizeRegression(name, value) {
  const failureCode = name === 'ocr' ? 'OCR_REGRESSION_FAILED' : 'UPDATE_REGRESSION_FAILED';
  if (!value || typeof value !== 'object' || Array.isArray(value) || value.ok !== true) {
    return { status: 'unavailable', code: failureCode };
  }
  if (name === 'ocr') {
    const matchesExpected = value.matchesExpected === true;
    if (!matchesExpected) return { status: 'unavailable', code: failureCode };
    const chars = Number.isSafeInteger(value.chars) && value.chars >= 0 ? value.chars : 0;
    return { status: 'ready', code: 'OCR_REGRESSION_READY', chars, matchesExpected };
  }
  if (name === 'update') {
    const checks = {
      signature: value.checks?.signature === true,
      archive: value.checks?.archive === true,
      rollback: value.checks?.rollback === true,
    };
    if (!Object.values(checks).every(Boolean)) return { status: 'unavailable', code: failureCode };
    return { status: 'ready', code: 'UPDATE_REGRESSION_READY', checks };
  }
  return { status: 'unavailable', code: failureCode };
}

function buildReport({
  deep = false,
  ocrProbe = () => inspectOcr(),
  audioProbe = () => runJsonProbe('python3', ['tools/audio_hardware_preflight.py', '--json']),
  asrProbe = () => runJsonProbe('python3', ['tools/asr_runtime_preflight.py', '--json']),
  updateProbe = () => inspectUpdateTools(),
  ocrVerify = () => runJsonCommand(process.execPath, [path.join(__dirname, 'screen-ocr-verify.cjs'), '--json'], { timeoutMs: DEEP_VERIFY_TIMEOUT_MS }),
  updateVerify = () => runJsonCommand(process.execPath, [path.join(__dirname, 'update-verify.cjs'), '--json'], { timeoutMs: DEEP_VERIFY_TIMEOUT_MS }),
} = {}) {
  const probes = { ocr: ocrProbe, audio: audioProbe, asr: asrProbe, update: updateProbe };
  const checks = {};
  for (const [name, probe] of Object.entries(probes)) {
    let value;
    try {
      value = sanitizeProbe(name, probe());
    } catch {
      value = failedProbe();
    }
    checks[name] = { status: statusFor(name, value), ...value };
  }
  const statuses = Object.values(checks).map((check) => check.status);
  const summary = {
    checked: statuses.length,
    ready: statuses.filter((status) => status === 'ready').length,
    unavailable: statuses.filter((status) => status === 'unavailable').length,
    needs_configuration: statuses.filter((status) => status === 'needs_configuration').length,
  };
  const report = { ok: summary.ready === summary.checked, code: 'CAPABILITIES_PARTIAL', summary, checks };
  if (deep) {
    const verifications = { ocr: ocrVerify, update: updateVerify };
    const regressionChecks = {};
    for (const [name, verify] of Object.entries(verifications)) {
      let value;
      try {
        value = sanitizeRegression(name, verify());
      } catch {
        value = sanitizeRegression(name, null);
      }
      checks[name].deep = value;
      regressionChecks[name] = value;
    }
    const regressionStatuses = Object.values(regressionChecks).map((check) => check.status);
    const regressions = {
      checked: regressionStatuses.length,
      ready: regressionStatuses.filter((status) => status === 'ready').length,
      unavailable: regressionStatuses.filter((status) => status === 'unavailable').length,
    };
    report.deep = true;
    report.regressions = regressions;
    report.ok = report.ok && regressions.ready === regressions.checked;
  }
  report.code = report.ok ? 'CAPABILITIES_READY' : 'CAPABILITIES_PARTIAL';
  return report;
}

function main(argv = process.argv.slice(2)) {
  const report = buildReport({ deep: argv.includes('--deep') });
  if (argv.includes('--json')) process.stdout.write(`${JSON.stringify(report)}\n`);
  else {
    const deepText = report.deep ? `, ${report.regressions.ready}/${report.regressions.checked} deep regressions ready` : '';
    process.stdout.write(`Capability preflight: ${report.summary.ready}/${report.summary.checked} ready, ${report.summary.needs_configuration} need configuration, ${report.summary.unavailable} unavailable${deepText}.\n`);
  }
  return report.ok || !argv.includes('--strict') ? 0 : 2;
}

if (require.main === module) process.exitCode = main();

module.exports = {
  DEEP_VERIFY_TIMEOUT_MS,
  PROBE_TIMEOUT_MS,
  buildReport,
  inspectUpdateTools,
  main,
  runJsonCommand,
  runJsonProbe,
  sanitizeProbe,
  sanitizeRegression,
  statusFor,
};
