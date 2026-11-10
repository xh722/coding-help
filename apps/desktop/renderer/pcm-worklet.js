'use strict';

class PcmCaptureProcessor extends AudioWorkletProcessor {
  constructor() {
    super();
    this.blockFrames = Math.max(1, Math.round(sampleRate * 0.02));
    this.offset = 0;
    this.allocateBlock();
  }

  allocateBlock() {
    this.block = new ArrayBuffer(this.blockFrames * 2);
    this.view = new DataView(this.block);
  }

  process(inputs, outputs) {
    // The graph stays connected so Chromium schedules the worklet; output is silent.
    for (const output of outputs) for (const channel of output) channel.fill(0);
    const channels = inputs[0];
    if (!channels?.length) return true;
    const frames = channels[0].length;
    for (let frame = 0; frame < frames; frame++) {
      let mono = 0;
      for (const channel of channels) mono += channel[frame];
      mono /= channels.length;
      if (!Number.isFinite(mono)) mono = 0;
      mono = Math.max(-1, Math.min(1, mono));
      this.view.setInt16(this.offset * 2, mono < 0 ? mono * 32768 : mono * 32767, true);
      this.offset++;
      if (this.offset === this.blockFrames) {
        this.port.postMessage(this.block, [this.block]);
        this.offset = 0;
        this.allocateBlock();
      }
    }
    return true;
  }
}

registerProcessor('pcm-capture', PcmCaptureProcessor);
