const nodeFs = require('node:fs');

const MAX_AUDIO_BYTES = 64 * 1024 * 1024;
const MAX_CHUNKS = 65536;
const typedError = (code, message) => Object.assign(new Error(message), { code });
const validLayout = (sampleRate, channels) => Number.isInteger(sampleRate) && sampleRate > 0 && sampleRate <= 384000
  && Number.isInteger(channels) && channels > 0 && channels <= 32;

function readWavFile(filePath, fs = nodeFs) {
  let buffer;
  try {
    if (typeof fs.statSync === 'function' && fs.statSync(filePath).size > MAX_AUDIO_BYTES) {
      throw typedError('AUDIO_TOO_LARGE', 'Audio input exceeds the 64 MiB limit.');
    }
    buffer = fs.readFileSync(filePath);
  } catch (error) {
    if (error.code === 'AUDIO_TOO_LARGE') throw error;
    throw typedError(error.code === 'ENOENT' ? 'FILE_NOT_FOUND' : 'FILE_READ_ERROR', 'Unable to read audio file.');
  }
  if (!(buffer instanceof Uint8Array)) throw typedError('MALFORMED_WAV', 'Invalid WAV input.');
  if (buffer.byteLength > MAX_AUDIO_BYTES) throw typedError('AUDIO_TOO_LARGE', 'Audio input exceeds the 64 MiB limit.');
  if (!Buffer.isBuffer(buffer)) buffer = Buffer.from(buffer);
  const malformed = () => { throw typedError('MALFORMED_WAV', 'Invalid PCM WAV structure.'); };
  if (buffer.length < 12 || buffer.toString('ascii', 0, 4) !== 'RIFF' || buffer.toString('ascii', 8, 12) !== 'WAVE'
    || buffer.readUInt32LE(4) + 8 !== buffer.length) malformed();
  let offset = 12;
  let fmt = null;
  let data = null;
  while (offset < buffer.length) {
    if (offset + 8 > buffer.length) malformed();
    const id = buffer.toString('ascii', offset, offset + 4);
    const size = buffer.readUInt32LE(offset + 4);
    const start = offset + 8;
    const end = start + size;
    const paddedEnd = end + size % 2;
    if (paddedEnd > buffer.length || (size % 2 && buffer[end] !== 0)) malformed();
    if (id === 'fmt ') {
      if (fmt || (size !== 16 && size !== 18)) malformed();
      if (buffer.readUInt16LE(start) !== 1) throw typedError('UNSUPPORTED_FORMAT', 'Only integer PCM WAV audio is supported.');
      if (size === 18 && buffer.readUInt16LE(start + 16) !== 0) malformed();
      fmt = {
        channels: buffer.readUInt16LE(start + 2), sampleRate: buffer.readUInt32LE(start + 4),
        byteRate: buffer.readUInt32LE(start + 8), blockAlign: buffer.readUInt16LE(start + 12), bitsPerSample: buffer.readUInt16LE(start + 14),
      };
    } else if (id === 'data') {
      if (data !== null) malformed();
      data = buffer.subarray(start, end);
    }
    offset = paddedEnd;
  }
  if (!fmt || !data || !validLayout(fmt.sampleRate, fmt.channels) || ![8, 16, 24, 32].includes(fmt.bitsPerSample)
    || fmt.blockAlign !== fmt.channels * fmt.bitsPerSample / 8 || fmt.byteRate !== fmt.sampleRate * fmt.blockAlign
    || data.length % fmt.blockAlign !== 0) malformed();
  return { sampleRate: fmt.sampleRate, channels: fmt.channels, bitsPerSample: fmt.bitsPerSample, data: Buffer.from(data) };
}

function validateWavCapture(wav, chunkDurationMs = 20) {
  const frameSize = wav.channels * wav.bitsPerSample / 8;
  const bytesPerChunk = Math.max(1, Math.floor(wav.sampleRate * chunkDurationMs / 1000)) * frameSize;
  if (Math.ceil(wav.data.length / bytesPerChunk) > MAX_CHUNKS) {
    throw typedError('AUDIO_TOO_LONG', 'Audio input has too many chunks.');
  }
  return bytesPerChunk;
}

function createAudioCaptureProvider({
  source = 'deterministic', chunks, filePath, fs = nodeFs, clock = globalThis,
  sampleRate = 16000, channels = 1, chunkDurationMs = 20,
} = {}) {
  const setTimer = typeof clock.setTimeout === 'function' ? clock.setTimeout.bind(clock) : globalThis.setTimeout.bind(globalThis);
  const clearTimer = typeof clock.clearTimeout === 'function' ? clock.clearTimeout.bind(clock) : globalThis.clearTimeout.bind(globalThis);
  const now = typeof clock.now === 'function' ? clock.now.bind(clock) : Date.now;
  let state = 'idle';
  let timer = null;
  let prepared = null;
  let index = 0;
  let sampleOffset = 0;
  let bitsPerSample = 16;
  let onEvent = null;
  let onChunk = null;
  const metadata = () => ({ source: ['deterministic', 'chunks', 'file', 'device'].includes(source) ? source : 'unsupported', sampleRate, channels, bitsPerSample, format: bitsPerSample === 8 ? 'pcm_u8' : `pcm_s${bitsPerSample}le`, timestamp: now() });

  function release() {
    if (timer !== null) clearTimer(timer);
    timer = null;
    prepared = null;
    chunks = null;
    filePath = null;
    fs = null;
    onChunk = null;
  }

  function fail(code, message) {
    state = 'stopped';
    const consumer = onEvent;
    release();
    onEvent = null;
    if (consumer) {
      try { consumer({ type: 'audio.error', ...metadata(), code, message }); } catch {
        if (code !== 'AUDIO_CONSUMER_ERROR') {
          try { consumer({ type: 'audio.error', ...metadata(), code: 'AUDIO_CONSUMER_ERROR', message: 'Audio consumer failed.' }); } catch { /* Do not recurse into a failing consumer. */ }
        }
      }
    }
  }

  function emit(type) {
    try { if (onEvent) onEvent({ type, ...metadata() }); return true; } catch {
      fail('AUDIO_CONSUMER_ERROR', 'Audio consumer failed.');
      return false;
    }
  }

  function stop() {
    if (state === 'stopped') return;
    state = 'stopped';
    release();
    emit('audio.stopped');
    onEvent = null;
  }

  function duration(chunk) { return chunk.length / (channels * bitsPerSample / 8) / sampleRate * 1000; }

  function schedule() {
    if (state !== 'active' || timer !== null || !prepared || index >= prepared.length) return;
    const delay = source === 'file' ? duration(prepared[index]) : chunkDurationMs;
    timer = setTimer(() => {
      timer = null;
      if (state !== 'active' || !prepared) return;
      const chunk = prepared[index];
      const details = { ...metadata(), sequence: index++, sampleOffset, durationMs: duration(chunk) };
      sampleOffset += chunk.length / (channels * bitsPerSample / 8);
      try { if (onChunk) onChunk(chunk, details); } catch {
        fail('AUDIO_CONSUMER_ERROR', 'Audio consumer failed.');
        return;
      }
      if (state === 'stopped' || !prepared) return;
      if (index >= prepared.length) stop();
      else schedule();
    }, delay);
  }

  function prepare() {
    if (!validLayout(sampleRate, channels) || !Number.isFinite(chunkDurationMs) || chunkDurationMs < 0.1 || chunkDurationMs > 60000) {
      throw typedError('INVALID_CONFIGURATION', 'Invalid audio capture configuration.');
    }
    if (source === 'file') {
      const wav = readWavFile(filePath, fs);
      sampleRate = wav.sampleRate;
      channels = wav.channels;
      bitsPerSample = wav.bitsPerSample;
      const bytesPerChunk = validateWavCapture(wav, chunkDurationMs);
      const result = [];
      for (let offset = 0; offset < wav.data.length; offset += bytesPerChunk) result.push(wav.data.subarray(offset, offset + bytesPerChunk));
      return result;
    }
    if (source !== 'deterministic' && source !== 'chunks') throw typedError('UNSUPPORTED_SOURCE', 'Audio source is not supported.');
    if (!Array.isArray(chunks)) throw typedError('INVALID_SOURCE', 'Deterministic audio source requires chunks.');
    if (chunks.length > MAX_CHUNKS) throw typedError('AUDIO_TOO_LARGE', 'Audio input has too many chunks.');
    let total = 0;
    for (const chunk of chunks) {
      if (!(chunk instanceof Uint8Array) || !chunk.length || chunk.length % (channels * 2)) throw typedError('INVALID_CHUNK', 'Audio chunks must contain complete PCM frames.');
      total += chunk.length;
      if (total > MAX_AUDIO_BYTES) throw typedError('AUDIO_TOO_LARGE', 'Audio input exceeds the 64 MiB limit.');
    }
    return chunks.map((chunk) => Buffer.from(chunk));
  }

  return {
    start(options = {}) {
      if (state !== 'idle') return false;
      onEvent = typeof options.onEvent === 'function' ? options.onEvent : null;
      onChunk = typeof options.onChunk === 'function' ? options.onChunk : null;
      try { prepared = prepare(); } catch (error) {
        fail(error.code || 'AUDIO_ERROR', error.code ? error.message : 'Unable to prepare audio input.');
        return false;
      }
      chunks = null;
      filePath = null;
      fs = null;
      state = 'active';
      if (!emit('audio.started')) return false;
      if (state === 'stopped') return true;
      if (prepared.length === 0) stop();
      else schedule();
      return true;
    },
    pause() {
      if (state !== 'active') return;
      state = 'paused';
      if (timer !== null) clearTimer(timer);
      timer = null;
      emit('audio.paused');
    },
    resume() {
      if (state !== 'paused') return;
      state = 'active';
      if (emit('audio.resumed')) schedule();
    },
    stop,
    getState() { return state; },
  };
}

module.exports = { createAudioCaptureProvider, readWavFile, validateWavCapture };
