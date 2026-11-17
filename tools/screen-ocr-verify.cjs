'use strict';

const fs = require('node:fs');
const { createScreenOcrProvider } = require('../packages/providers/screen-ocr.cjs');

// A small, fixed 1-bit PNG keeps the default check independent of a display or image tool.
const EMBEDDED_SELF_TEST_PNG = 'iVBORw0KGgoAAAANSUhEUgAAAUAAAABQAQAAAABASpEoAAABkklEQVR42u2VMW7cMBBFH0UiFowAq3TuJOQEewMpN8kRcgAH5sI+iG9iqkvpEwRcwIVLbZCCMShOipVWDLxB3EesBPLxzx/+AaSEt62CFVzBFfyPwT3sK0ZDbw8WREHf7QyiVKsKKUal7Kx4/5On0R5vvtBJ941xEvohXVbaJjw4BxDwCWC6N+QeBcHNGwNDBJaNDEwXzu4i1gP46xBqpwdUrN0m+ahDO3uMV9uHdxoDQH8bh89byklIaZt5bEpKThsWW2Y1s2YCfAc5Grck/9cH7wwVXAJg6FR2LvYfyYQO4GCau1dgIizcWJ2+7CvFD7mims6r+UEXMJ618P7M9DTXeRMAbKL2PgNdZIDeHoWdgPZzt1eZYgkfITANQ9EA1Zy1yUv7QJiTSVjs0r/PPZrnx08v8wC2X011/0g5EU9xAVXzq+PGDDcP7Cq4o9xP+XIoxrJZLBRge7B7gIbSAGY4k7WymoZTl9s/Y53VxVP7WqJ24r+wkaREXHubLiTWCRW0hFZERK3/6xVcwRVcwbPrN2pjmNvjFGqmAAAAAElFTkSuQmCC';
const SELF_TEST_TEXT = 'LOCAL OCR TEST';

function normalizeText(value) {
  return String(value || '').replace(/\s+/g, ' ').trim().toUpperCase();
}

function safeFailure(code, source) {
  return { ok: false, code: ['OCR_UNAVAILABLE', 'OCR_TIMEOUT', 'OCR_INVALID_RESULT'].includes(code) ? code : 'OCR_UNAVAILABLE', source };
}

async function runVerification({
  pngPath,
  language,
  readFile = fs.readFileSync,
  recognizer,
  clock = Date.now,
} = {}) {
  const embedded = !pngPath;
  const source = embedded ? 'embedded-self-test' : 'provided-png';
  let png;
  try {
    png = embedded ? Buffer.from(EMBEDDED_SELF_TEST_PNG, 'base64') : Buffer.from(readFile(pngPath));
  } catch {
    return safeFailure('OCR_INVALID_RESULT', source);
  }
  const recognize = recognizer || createScreenOcrProvider().recognize;
  const selectedLanguage = language || (embedded ? 'eng' : 'chi_sim+eng');
  const started = clock();
  let result;
  try {
    result = await recognize({ png, language: selectedLanguage });
  } catch {
    return safeFailure('OCR_UNAVAILABLE', source);
  }
  const latency = Math.max(0, Number(clock()) - Number(started));
  if (!result?.ok) return safeFailure(result?.code, source);
  const text = typeof result.text === 'string' ? result.text : '';
  const chars = Number.isSafeInteger(result.chars) && result.chars >= 0 ? result.chars : text.length;
  const report = {
    ok: true,
    source,
    language: typeof result.language === 'string' ? result.language : selectedLanguage,
    chars,
    latency_ms: Math.round(latency * 100) / 100,
    matchesExpected: embedded ? normalizeText(text) === SELF_TEST_TEXT : null,
  };
  if (embedded && !report.matchesExpected) return { ...report, ok: false, code: 'OCR_MISMATCH' };
  return report;
}

async function main(argv = process.argv.slice(2)) {
  const pngIndex = argv.indexOf('--png');
  const pngPath = pngIndex >= 0 ? argv[pngIndex + 1] : undefined;
  if (pngIndex >= 0 && (!pngPath || pngPath.startsWith('--'))) {
    process.stdout.write(`${JSON.stringify(safeFailure('OCR_INVALID_RESULT', 'provided-png'))}\n`);
    return 2;
  }
  const languageIndex = argv.indexOf('--language');
  const language = languageIndex >= 0 ? argv[languageIndex + 1] : undefined;
  const result = await runVerification({ pngPath, language });
  if (argv.includes('--json')) {
    process.stdout.write(`${JSON.stringify(result)}\n`);
  } else if (result.ok) {
    process.stdout.write(`OCR verification passed: ${result.chars} characters, ${result.latency_ms} ms.\n`);
  } else {
    process.stdout.write(`NOT VERIFIED: ${result.code}.\n`);
  }
  return result.ok ? 0 : 2;
}

if (require.main === module) main().then((code) => { process.exitCode = code; });

module.exports = { EMBEDDED_SELF_TEST_PNG, SELF_TEST_TEXT, normalizeText, runVerification, main };
