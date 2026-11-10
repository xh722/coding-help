const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const path = require('node:path');

function worklet(rate = 16000) {
  const file = path.join(__dirname, '../apps/desktop/renderer/pcm-worklet.js');
  assert.ok(fs.existsSync(file), 'PCM worklet is not implemented');
  let Processor; const sent = [];
  class Base { constructor() { this.port = { postMessage: (data, transfer) => sent.push({ data, transfer }) }; } }
  vm.runInNewContext(fs.readFileSync(file, 'utf8'), { sampleRate: rate, AudioWorkletProcessor: Base, registerProcessor(name, value) { assert.equal(name, 'pcm-capture'); Processor = value; } });
  return { processor: new Processor(), sent };
}

test('worklet downmixes and clamps signed16 little endian, while zeroing every output', () => {
  const { processor, sent } = worklet();
  const left = new Float32Array(320); const right = new Float32Array(320);
  left.set([2, -2, 0.5, -0.5, 1, NaN]); right.set([2, -2, 0.5, -0.5, -1, NaN]);
  const out = [[new Float32Array(320).fill(1), new Float32Array(320).fill(1)]];
  assert.equal(processor.process([[left, right]], out), true);
  assert.equal(sent.length, 1); assert.equal(sent[0].data.byteLength, 640);
  assert.deepEqual([...new Uint8Array(sent[0].data).slice(0, 12)], [255, 127, 0, 128, 255, 63, 0, 192, 0, 0, 0, 0]);
  assert.equal(sent[0].transfer[0], sent[0].data);
  assert.ok(out[0].every((channel) => channel.every((value) => value === 0)));
});

test('worklet accumulates arbitrary render quanta into actual-rate 20ms blocks without gaps', () => {
  const { processor, sent } = worklet(48000);
  for (let i = 0; i < 15; i++) processor.process([[new Float32Array(128).fill(i < 7 ? 1 : -1)]], [[new Float32Array(128)]]);
  assert.equal(sent.length, 2); assert.deepEqual(sent.map((p) => p.data.byteLength), [1920, 1920]);
  const first = new DataView(sent[0].data); const second = new DataView(sent[1].data);
  assert.equal(first.getInt16(1790, true), 32767); assert.equal(first.getInt16(1792, true), -32768);
  assert.equal(first.getInt16(1918, true), -32768); assert.equal(second.getInt16(0, true), -32768);
});

test('worklet supports several completed blocks per call and no-input calls emit nothing', () => {
  const { processor, sent } = worklet(16000);
  const output = new Float32Array(128).fill(0.7);
  processor.process([], [[output]]); assert.equal(sent.length, 0); assert.ok(output.every((v) => v === 0));
  processor.process([[new Float32Array(650).fill(0.5)]], []); assert.equal(sent.length, 2);
  processor.process([[new Float32Array(310).fill(-0.5)]], []); assert.equal(sent.length, 3);
  const third = new DataView(sent[2].data);
  assert.equal(third.getInt16(18, true), 16383); assert.equal(third.getInt16(20, true), -16384);
});
