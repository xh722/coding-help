'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { EventEmitter } = require('node:events');
const { createScreenOcrProvider } = require('../packages/providers/screen-ocr.cjs');

function fakeChild({ output = '', code = 0, error = null, hold = false } = {}) {
  const child = new EventEmitter();
  child.stdout = new EventEmitter();
  child.stderr = new EventEmitter();
  child.stdin = {
    end(input) {
      child.input = Buffer.from(input);
      if (hold) return;
      queueMicrotask(() => {
        if (error) child.emit('error', error);
        else {
          if (output) child.stdout.emit('data', Buffer.from(output));
          child.emit('close', code);
        }
      });
    },
  };
  child.kill = () => { child.killed = true; child.emit('close', null); };
  return child;
}

test('OCR provider invokes fixed tesseract argv and returns bounded text', async () => {
  let invocation;
  let child;
  const provider = createScreenOcrProvider({
    spawnImpl: (command, args, options) => {
      invocation = { command, args, options };
      child = fakeChild({ output: '  状态解释\n' });
      return child;
    },
  });
  const result = await provider.recognize({ png: Buffer.from('png-bytes') });
  assert.deepEqual(result, { ok: true, text: '状态解释', language: 'chi_sim+eng', chars: 4 });
  assert.deepEqual(invocation.args, ['stdin', 'stdout', '--psm', '6', '-l', 'chi_sim+eng']);
  assert.equal(invocation.command, 'tesseract');
  assert.equal(invocation.options.shell, false);
  assert.deepEqual(invocation.options.stdio, ['pipe', 'pipe', 'pipe']);
  assert.deepEqual(child.input, Buffer.from('png-bytes'));
});

test('OCR provider returns static unavailable result for missing executable or non-zero exit', async () => {
  const missing = createScreenOcrProvider({ spawnImpl: () => { throw Object.assign(new Error('/private/tool'), { code: 'ENOENT' }); } });
  assert.deepEqual(await missing.recognize({ png: Buffer.from('png') }), { ok: false, code: 'OCR_UNAVAILABLE' });
  const failed = createScreenOcrProvider({ spawnImpl: () => fakeChild({ code: 1 }) });
  assert.deepEqual(await failed.recognize({ png: Buffer.from('png') }), { ok: false, code: 'OCR_UNAVAILABLE' });
});

test('OCR provider times out and terminates the child without leaking stderr', async () => {
  let child;
  const provider = createScreenOcrProvider({ timeoutMs: 5, spawnImpl: () => { child = fakeChild({ hold: true }); return child; } });
  const result = await provider.recognize({ png: Buffer.from('png') });
  assert.deepEqual(result, { ok: false, code: 'OCR_TIMEOUT' });
  assert.equal(child.killed, true);
  assert.doesNotMatch(JSON.stringify(result), /private|secret|stderr/);
});

test('OCR provider rejects invalid language, empty input and oversized input', async () => {
  const provider = createScreenOcrProvider({ maxInputBytes: 3, spawnImpl: () => fakeChild({ output: 'ignored' }) });
  for (const input of [undefined, null, Buffer.alloc(0), Buffer.from('1234')]) {
    assert.deepEqual(await provider.recognize({ png: input }), { ok: false, code: 'OCR_INVALID_RESULT' });
  }
  assert.deepEqual(await provider.recognize({ png: Buffer.from('png'), language: '中文;rm -rf /' }), { ok: false, code: 'OCR_INVALID_RESULT' });
});

test('OCR provider rejects output above the configured character limit', async () => {
  const provider = createScreenOcrProvider({ maxOutputChars: 4, spawnImpl: () => fakeChild({ output: '12345' }) });
  const result = await provider.recognize({ png: Buffer.from('png') });
  assert.deepEqual(result, { ok: false, code: 'OCR_INVALID_RESULT' });
});
