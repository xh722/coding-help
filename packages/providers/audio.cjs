const nodeFs = require('node:fs');

function typedError(code, message, cause) {
  const error = new Error(message);
  error.code = code;
  if (cause) error.cause = cause;
  return error;
}

function readWavFile(filePath, fs = nodeFs) {
  let buffer;
  try {
    buffer = fs.readFileSync(filePath);
  } catch (error) {
    if (error && error.code === 'ENOENT') throw typedError('FILE_NOT_FOUND', `Audio file not found: ${filePath}`, error);
    throw typedError('FILE_READ_ERROR', `Unable to read audio file: ${filePath}`, error);
  }
  if (!Buffer.isBuffer(buffer)) buffer = Buffer.from(buffer);
  if (buffer.length < 12 || buffer.toString('ascii', 0, 4) !== 'RIFF' || buffer.toString('ascii', 8, 12) !== 'WAVE') {
    throw typedError('MALFORMED_WAV', 'Audio file is not a RIFF/WAVE file.');
  }

  let offset = 12;
  let fmt = null;
  let data = null;
  while (offset + 8 <= buffer.length) {
    const id = buffer.toString('ascii', offset, offset + 4);
    const size = buffer.readUInt32LE(offset + 4);
    const start = offset + 8;
    const end = start + size;
    if (end > buffer.length) throw typedError('MALFORMED_WAV', 'WAV chunk extends beyond the file.');
    if (id === 'fmt ') {
      if (size < 16) throw typedError('MALFORMED_WAV', 'WAV format chunk is incomplete.');
      fmt = {
        audioFormat: buffer.readUInt16LE(start),
        channels: buffer.readUInt16LE(start + 2),
        sampleRate: buffer.readUInt32LE(start + 4),
        bitsPerSample: buffer.readUInt16LE(start + 14),
      };
    } else if (id === 'data') {
      data = Buffer.from(buffer.subarray(start, end));
    }
    offset = end + (size % 2);
  }
  if (!fmt || !data || fmt.audioFormat !== 1 || !fmt.channels || !fmt.sampleRate || ![8, 16, 24, 32].includes(fmt.bitsPerSample)) {
    throw typedError('MALFORMED_WAV', 'WAV file must contain supported PCM format and data chunks.');
  }
  return { sampleRate: fmt.sampleRate, channels: fmt.channels, bitsPerSample: fmt.bitsPerSample, data };
}

function createAudioCaptureProvider({
  source = 'deterministic',
  chunks,
  filePath,
  fs = nodeFs,
  clock = globalThis,
  sampleRate = 16000,
  channels = 1,
  chunkDurationMs = 20,
} = {}) {
  const setTimeoutFn = typeof clock.setTimeout === 'function' ? clock.setTimeout.bind(clock) : globalThis.setTimeout.bind(globalThis);
  const clearTimeoutFn = typeof clock.clearTimeout === 'function' ? clock.clearTimeout.bind(clock) : globalThis.clearTimeout.bind(globalThis);
  const now = typeof clock.now === 'function' ? clock.now.bind(clock) : Date.now;
  let state = 'idle';
  let timer = null;
  let index = 0;
  let prepared = null;
  let bitsPerSample = 16;
  let onEvent = () => {};
  let onChunk = () => {};

  const emit = (type, extra = {}) => onEvent({ type, ...extra });
  const format = () => bitsPerSample === 8 ? 'pcm_s8' : `pcm_s${bitsPerSample}le`;
  const metadata = () => ({ source, sampleRate, channels, format: format(), timestamp: now() });

  const schedule = () => {
    if (state !== 'active' || index >= prepared.length) return;
    timer = setTimeoutFn(() => {
      timer = null;
      if (state !== 'active') return;
      const chunk = prepared[index++];
      onChunk(chunk, metadata());
      if (index >= prepared.length) {
        state = 'stopped';
        emit('audio.stopped', { source });
      } else {
        schedule();
      }
    }, chunkDurationMs);
  };

  const prepare = () => {
    if (source === 'file') {
      const wav = readWavFile(filePath, fs);
      sampleRate = wav.sampleRate;
      channels = wav.channels;
      bitsPerSample = wav.bitsPerSample;
      const bytesPerSecond = wav.sampleRate * wav.channels * (wav.bitsPerSample / 8);
      const bytesPerChunk = Math.max(1, Math.round(bytesPerSecond * (chunkDurationMs / 1000)));
      const result = [];
      for (let offset = 0; offset < wav.data.length; offset += bytesPerChunk) result.push(wav.data.subarray(offset, Math.min(offset + bytesPerChunk, wav.data.length)));
      return result;
    }
    if (source === 'deterministic' || source === 'chunks') {
      if (!Array.isArray(chunks)) throw typedError('INVALID_SOURCE', 'Deterministic audio source requires chunks.');
      return chunks.map((chunk) => {
        if (!Buffer.isBuffer(chunk) && !(chunk instanceof Uint8Array)) throw typedError('INVALID_CHUNK', 'Audio chunks must be Buffer or Uint8Array.');
        return Buffer.from(chunk);
      });
    }
    throw typedError('UNSUPPORTED_SOURCE', 'Audio source is not supported.');
  };

  return {
    start(options = {}) {
      if (state !== 'idle') return;
      onEvent = typeof options.onEvent === 'function' ? options.onEvent : () => {};
      onChunk = typeof options.onChunk === 'function' ? options.onChunk : () => {};
      try {
        prepared = prepare();
      } catch (error) {
        state = 'stopped';
        emit('audio.error', { source, code: error.code || 'AUDIO_ERROR', message: error.message });
        return;
      }
      index = 0;
      state = 'active';
      emit('audio.started', { source, sampleRate, channels, format: format() });
      if (prepared.length === 0) {
        state = 'stopped';
        emit('audio.stopped', { source });
      } else schedule();
    },
    pause() {
      if (state !== 'active') return;
      state = 'paused';
      if (timer !== null) clearTimeoutFn(timer);
      timer = null;
      emit('audio.paused', { source });
    },
    resume() {
      if (state !== 'paused') return;
      state = 'active';
      emit('audio.resumed', { source });
      schedule();
    },
    stop() {
      if (state === 'stopped' || state === 'idle') return;
      if (timer !== null) clearTimeoutFn(timer);
      timer = null;
      state = 'stopped';
      emit('audio.stopped', { source });
    },
    getState() { return state; },
  };
}

module.exports = { createAudioCaptureProvider, readWavFile };
