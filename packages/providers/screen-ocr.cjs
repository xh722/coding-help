'use strict';

const { spawn } = require('node:child_process');

const DEFAULT_TIMEOUT_MS = 3000;
const DEFAULT_MAX_INPUT_BYTES = 8 * 1024 * 1024;
const DEFAULT_MAX_OUTPUT_CHARS = 32768;
const LANGUAGE_RE = /^[A-Za-z0-9_.+-]{1,64}$/;

function invalidResult() {
  return { ok: false, code: 'OCR_INVALID_RESULT' };
}

function createScreenOcrProvider({
  spawnImpl = spawn,
  timeoutMs = DEFAULT_TIMEOUT_MS,
  maxInputBytes = DEFAULT_MAX_INPUT_BYTES,
  maxOutputChars = DEFAULT_MAX_OUTPUT_CHARS,
} = {}) {
  if (typeof spawnImpl !== 'function') throw new TypeError('spawnImpl must be a function');
  if (!Number.isFinite(timeoutMs) || timeoutMs <= 0) throw new RangeError('timeoutMs must be positive');
  if (!Number.isSafeInteger(maxInputBytes) || maxInputBytes <= 0) throw new RangeError('maxInputBytes must be positive');
  if (!Number.isSafeInteger(maxOutputChars) || maxOutputChars <= 0) throw new RangeError('maxOutputChars must be positive');

  return {
    recognize({ png, language = 'chi_sim+eng' } = {}) {
      if (!(png instanceof Uint8Array) || png.byteLength === 0 || png.byteLength > maxInputBytes) return Promise.resolve(invalidResult());
      if (typeof language !== 'string' || !LANGUAGE_RE.test(language)) return Promise.resolve(invalidResult());

      const input = Buffer.from(png);
      let child;
      try {
        child = spawnImpl('tesseract', ['stdin', 'stdout', '--psm', '6', '-l', language], {
          shell: false,
          stdio: ['pipe', 'pipe', 'pipe'],
        });
      } catch {
        return Promise.resolve({ ok: false, code: 'OCR_UNAVAILABLE' });
      }

      return new Promise((resolve) => {
        let settled = false;
        let timedOut = false;
        let outputBytes = 0;
        const output = [];
        const finish = (result) => {
          if (settled) return;
          settled = true;
          clearTimeout(timer);
          resolve(result);
        };
        const timer = setTimeout(() => {
          timedOut = true;
          finish({ ok: false, code: 'OCR_TIMEOUT' });
          try { child.kill('SIGKILL'); } catch {}
        }, timeoutMs);

        child.stdout?.on('data', (chunk) => {
          if (settled) return;
          const bytes = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
          outputBytes += bytes.length;
          if (outputBytes > (maxOutputChars * 4) + 16) {
            finish(invalidResult());
            try { child.kill('SIGKILL'); } catch {}
            return;
          }
          output.push(bytes);
        });
        child.stderr?.on('data', () => {});
        child.once('error', () => {
          if (!timedOut) finish({ ok: false, code: 'OCR_UNAVAILABLE' });
        });
        child.once('close', (code) => {
          if (settled || timedOut) return;
          if (code !== 0) {
            finish({ ok: false, code: 'OCR_UNAVAILABLE' });
            return;
          }
          const text = Buffer.concat(output).toString('utf8').trim();
          if (text.length > maxOutputChars) {
            finish(invalidResult());
            return;
          }
          finish({ ok: true, text, language, chars: text.length });
        });

        try {
          child.stdin.end(input);
        } catch {
          finish({ ok: false, code: 'OCR_UNAVAILABLE' });
        }
      });
    },
  };
}

module.exports = {
  createScreenOcrProvider,
  DEFAULT_TIMEOUT_MS,
  DEFAULT_MAX_INPUT_BYTES,
  DEFAULT_MAX_OUTPUT_CHARS,
};
