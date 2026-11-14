// Debug recording for the browser tests. Not part of the release: the test
// harness adds it to its own copy of the extension.
// Taps the original element audio and Musicless's output on the same clock so
// the browser tests can measure sync and leakage from what actually played.
// The taps are AudioWorklets (recorder-tap.js), which say exactly when each
// block was rendered in every browser.

const modules = new WeakMap(); // AudioContext -> the tap module loading into it

export class Recorder {
  constructor(ctx, original, output, video) {
    this.rate = ctx.sampleRate;
    this.ctx = ctx;
    this.video = video;
    this.media = []; // [clock time, media time] pairs for mapping output back to the video
    this.limit = this.rate * 180;
    this.tracks = { original: [], output: [] };
    this.lengths = { original: 0, output: 0 };
    if (!modules.has(ctx)) modules.set(ctx, ctx.audioWorklet.addModule(chrome.runtime.getURL("recorder-tap.js")));
    modules.get(ctx).then(() => {
      const sink = ctx.createGain();
      sink.gain.value = 0;
      sink.connect(ctx.destination);
      for (const [name, node] of [["original", original], ["output", output]]) {
        const tap = new AudioWorkletNode(ctx, "musicless-recorder-tap");
        tap.port.onmessage = ({ data }) => this.add(name, data.time, data.data);
        node.connect(tap);
        tap.connect(sink);
      }
    }, (error) => console.error("musicless test recorder:", error));
  }

  add(name, time, posted) {
    // A copy of its own: Firefox reads posted audio in a content script
    // through a wrapper, one sample at a time and far slower.
    const data = new Float32Array(posted.length);
    data.set(posted);
    const track = this.tracks[name];
    track.push({ time, data });
    if (name === "output") {
      // The media time this block was rendered at: the video's position now,
      // taken back to when the block was rendered, at the current speed.
      this.media.push([time, this.video.paused ? null : this.video.currentTime + (time - this.ctx.currentTime) * this.video.playbackRate]);
      if (this.media.length > 8000) this.media.shift();
    }
    this.lengths[name] += data.length;
    while (this.lengths[name] > this.limit) this.lengths[name] -= track.shift().data.length;
  }

  // Both tracks over the same clock span, as Int16 base64 for transport.
  dump(seconds) {
    seconds = Math.min(Math.max(Number(seconds) || 0, 0), this.limit / this.rate);
    const end = Math.min(...["original", "output"].map((name) => {
      const track = this.tracks[name];
      const last = track[track.length - 1];
      return last ? last.time + last.data.length / this.rate : 0;
    }));
    const start = end - seconds;
    const out = {};
    for (const name of ["original", "output"]) {
      const samples = new Int16Array(Math.round(seconds * this.rate));
      for (const block of this.tracks[name]) {
        if (block.time + block.data.length / this.rate < start) continue;
        const at = Math.round((block.time - start) * this.rate);
        for (let i = 0; i < block.data.length; i++) {
          const j = at + i;
          if (j >= 0 && j < samples.length) samples[j] = Math.max(-32768, Math.min(32767, block.data[i] * 32767));
        }
      }
      let binary = "";
      const bytes = new Uint8Array(samples.buffer);
      for (let i = 0; i < bytes.length; i += 0x8000) binary += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
      out[name] = btoa(binary);
    }
    const media = this.media.filter(([time]) => time >= start && time <= end).map(([time, m]) => [time - start, m]);
    return { rate: this.rate, start, seconds, media, ...out };
  }
}
