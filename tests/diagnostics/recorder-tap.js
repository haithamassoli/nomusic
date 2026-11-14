// Debug recording for the browser tests (see recorder.js). Hands what it hears
// to the page in blocks, each with the context time its first sample was
// rendered at: exact, unlike a ScriptProcessor's, whose delay varies by browser.

const BLOCK = 2048; // frames, a whole number of 128-frame render quanta

registerProcessor("musicless-recorder-tap", class extends AudioWorkletProcessor {
  constructor() {
    super();
    this.block = new Float32Array(BLOCK);
    this.filled = 0;
    this.start = 0;
  }

  process(inputs) {
    const [left, right = left] = inputs[0];
    if (this.filled === 0) this.start = currentTime;
    const frames = left?.length ?? 128; // no input connected yet is silence
    for (let i = 0; i < frames; i++) this.block[this.filled + i] = left ? 0.5 * (left[i] + right[i]) : 0;
    this.filled += frames;
    if (this.filled === BLOCK) {
      this.port.postMessage({ time: this.start, data: this.block }, [this.block.buffer]);
      this.block = new Float32Array(BLOCK);
      this.filled = 0;
    }
    return true;
  }
});
