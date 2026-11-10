'use strict';

const http = require('node:http');

const MAX_BYTES = 32 * 1024 * 1024;

function bad(message) { return Object.assign(new Error(message), { code: 'BAD_AUDIO' }); }

function validatePcmWav(buffer) {
  if (!Buffer.isBuffer(buffer) || buffer.length < 44 || buffer.length > MAX_BYTES) throw bad('Invalid audio body.');
  if (buffer.toString('ascii', 0, 4) !== 'RIFF' || buffer.toString('ascii', 8, 12) !== 'WAVE') throw bad('Invalid WAV container.');
  const riffSize = buffer.readUInt32LE(4); if (riffSize + 8 !== buffer.length) throw bad('Invalid RIFF length.');
  if (buffer.toString('ascii', 12, 16) !== 'fmt ' || buffer.readUInt32LE(16) < 16) throw bad('Missing PCM format.');
  const fmtSize = buffer.readUInt32LE(16); const format = buffer.readUInt16LE(20); const channels = buffer.readUInt16LE(22);
  const sampleRate = buffer.readUInt32LE(24); const blockAlign = buffer.readUInt16LE(32); const bits = buffer.readUInt16LE(34);
  const dataOffset = 20 + fmtSize;
  if (format !== 1 || !channels || !sampleRate || ![8, 16, 24, 32].includes(bits) || blockAlign !== channels * bits / 8 || dataOffset + 8 > buffer.length) throw bad('Unsupported PCM format.');
  if (buffer.toString('ascii', dataOffset, dataOffset + 4) !== 'data') throw bad('Missing PCM data.');
  const dataSize = buffer.readUInt32LE(dataOffset + 4); if (dataSize !== buffer.length - dataOffset - 8 || dataSize % blockAlign !== 0) throw bad('Invalid PCM data length.');
  return { channels, sampleRate, bitsPerSample: bits, bytes: dataSize };
}

function createFixtureServer({ host = '127.0.0.1', port = 0, text = 'Fixture local ASR response.', once = false, logger = () => {} } = {}) {
  let requestCount = 0;
  const server = http.createServer((request, response) => {
    if (request.method !== 'POST' || request.url !== '/transcribe') { response.writeHead(404).end(); return; }
    const chunks = []; let total = 0; let failed = false;
    request.on('data', (chunk) => {
      total += chunk.length;
      if (total > MAX_BYTES) { failed = true; request.destroy(); }
      else chunks.push(chunk);
    });
    request.on('end', () => {
      if (failed) return;
      try {
        const format = validatePcmWav(Buffer.concat(chunks)); requestCount++;
        const body = JSON.stringify({ text, fixture: true, format });
        response.writeHead(200, { 'content-type': 'application/json', 'cache-control': 'no-store' }); response.end(body);
        logger({ requestCount, format });
        if (once) server.close();
      } catch (error) {
        response.writeHead(400, { 'content-type': 'application/json', 'cache-control': 'no-store' }); response.end(JSON.stringify({ error: 'Invalid PCM WAV input.' }));
      }
    });
  });
  return {
    server,
    async start() { await new Promise((resolve, reject) => { server.once('error', reject); server.listen(port, host, resolve); }); return server.address(); },
    async stop() { if (!server.listening) return; await new Promise((resolve) => server.close(() => resolve())); },
    getRequestCount: () => requestCount,
  };
}

if (require.main === module) {
  const args = new Map(); for (let i = 2; i < process.argv.length; i += 1) if (process.argv[i].startsWith('--')) args.set(process.argv[i].slice(2), process.argv[i + 1]?.startsWith('--') ? true : process.argv[++i]);
  const fixture = createFixtureServer({ port: Number(args.get('port') || 43123), text: String(args.get('text') || 'Fixture local ASR response.'), once: args.has('once'), logger: (event) => console.log(JSON.stringify(event)) });
  fixture.start().then((address) => { console.log(`Fixture ASR listening on http://${address.address}:${address.port}/transcribe`); }).catch((error) => { console.error(error.message); process.exitCode = 1; });
  const close = () => fixture.stop().finally(() => process.exit(0)); process.once('SIGINT', close); process.once('SIGTERM', close);
}

module.exports = { createFixtureServer, validatePcmWav, MAX_BYTES };
