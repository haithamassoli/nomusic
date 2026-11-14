// ---------------------------------------------------------------------------
// Pitch-preserving time-stretch via the vendored SoundTouch library (WSOLA),
// for playback rates other than 1. Pure JavaScript on the main thread — no
// Worker/worklet/WASM/CSP concerns. See third_party/soundtouch/.
//
// A StretchedPlayback plays one chunk from a given point at a given rate. It
// is made a slice at a time as playback nears it (fill), from one continuous
// WSOLA stream, so a speed change goes straight to the stretched voice and the
// rest costs a little every tick. Neighbouring slices share a few
// milliseconds, crossfaded. The samples there are the same in both, so the sum
// is exact, and the edges the browser leaves when it resamples each slice to
// the device's rate fall where they fade out.
//
// Import only the WSOLA implementation; the package index also pulls in a rate
// transposer that Musicless does not use.
import Stretch from "./third_party/soundtouch/Stretch.js";

// WSOLA time-stretch tuning for speech/vocals. sequence/seek/overlap in ms.
//
// SoundTouch's auto/default tuning (sequence ~90 ms, overlap 8 ms at 2x) copies
// a long *verbatim* middle per window and then jumps — on speech that jump is
// an audible stutter ("two voices / chopping"). We instead use a short window
// with ~50% overlap (overlap ≈ sequence/2 → no verbatim middle, every output
// sample is a crossfade), which is how ffmpeg's `atempo` WSOLA is shaped. This
// was validated against atempo and rubberband on real separated-voice chunks: a
// spectral-similarity-to-atempo metric rose from ~0.91 (old params, audibly
// stuttering) to ~0.95 (these params, matching the clean references), and the
// per-chunk seam discontinuity dropped from ~55x to ~5x the median sample step.
//
// quickSeek MUST stay true: the exhaustive (quickSeek=false) seek measured
// ~45 ms vs ~950 ms per chunk here — synchronous on the main thread, the slow
// path froze the page, and it did not improve quality.
const WSOLA_SEQUENCE_MS = 40;
const WSOLA_SEEK_MS = 15;
const WSOLA_OVERLAP_MS = 20;
const WSOLA_QUICK_SEEK = true;

export const SLICE_FRAMES = 16384; // output frames per slice, ~0.37 s at 44.1 kHz
export const SHARED_FRAMES = 256; // ~6 ms each slice shares with the next
const BLOCK = 4096; // input frames fed to WSOLA at a time
const SILENCE = new Float32Array(BLOCK * 2);

export class StretchedPlayback {
  // Play `buffer` (stereo) from `offset` seconds into it at `rate`, pitch
  // preserved, from context time `when` on, into `destination`.
  constructor(buffer, offset, rate, when, destination) {
    this.ctx = destination.context;
    this.destination = destination;
    this.rate = rate;
    this.sampleRate = buffer.sampleRate;
    this.buffer = buffer;
    this.from = Math.min(buffer.length, Math.round(offset * buffer.sampleRate));
    this.frames = buffer.length - this.from;
    this.fed = 0; // input frames handed to WSOLA
    this.flushed = 0; // blocks of silence after the input, to empty WSOLA's last window
    this.target = Math.max(1, Math.ceil(this.frames / rate)); // output frames in all
    this.made = 0; // output frames scheduled
    this.next = when; // context time the next slice's new frames start at
    this.tail = null; // the previous slice's last frames, which the next one replays
    this.sources = [];
    this.stopped = false;
    this.onended = null;
    this.left = new Float32Array(BLOCK); // read()'s copies of the input
    this.right = new Float32Array(BLOCK);
    this.block = new Float32Array(BLOCK * 2);
    this.wsola = new Stretch({ createBuffers: true });
    this.wsola.setParameters(this.sampleRate, WSOLA_SEQUENCE_MS, WSOLA_SEEK_MS, WSOLA_OVERLAP_MS);
    this.wsola.tempo = rate; // tempo > 1 shortens (faster); pitch is preserved
    this.wsola.quickSeek = WSOLA_QUICK_SEEK;
  }

  // Make and schedule slices until playback is covered up to context time `until`.
  fill(until) {
    while (!this.stopped && this.made < this.target && this.next < until) this.slice();
  }

  stop(when) {
    this.stopped = true;
    for (const source of this.sources) {
      try {
        source.stop(when);
      } catch {
        // already stopped
      }
    }
  }

  disconnect() {
    for (const source of this.sources) source.disconnect();
  }

  // Up to `count` more output frames from the WSOLA stream, interleaved.
  pull(count) {
    const out = new Float32Array(count * 2);
    let got = 0;
    while (got < count) {
      const ready = this.wsola.outputBuffer.frameCount;
      if (ready > 0) {
        const n = Math.min(ready, count - got);
        this.wsola.outputBuffer.receiveSamples(out.subarray(got * 2), n);
        got += n;
      } else if (this.fed < this.frames) {
        const n = Math.min(BLOCK, this.frames - this.fed);
        this.wsola.inputBuffer.putSamples(this.read(this.from + this.fed, n), 0, n);
        this.fed += n;
        this.wsola.process();
      } else if (this.flushed++ < 64) {
        // Past the input: silence lets WSOLA emit its last window (it would
        // otherwise leave a small gap at the chunk's end).
        this.wsola.inputBuffer.putSamples(SILENCE, 0, BLOCK);
        this.wsola.process();
      } else {
        break;
      }
    }
    return out.subarray(0, got * 2);
  }

  // `count` frames of the chunk from `at`, interleaved as SoundTouch reads
  // them. Copied with copyFromChannel: once a buffer plays, Firefox detaches
  // the arrays getChannelData gave for it (Web Audio's "acquire the content").
  read(at, count) {
    this.buffer.copyFromChannel(this.left.subarray(0, count), 0, at);
    this.buffer.copyFromChannel(this.right.subarray(0, count), 1, at);
    for (let i = 0; i < count; i++) {
      this.block[2 * i] = this.left[i];
      this.block[2 * i + 1] = this.right[i];
    }
    return this.block.subarray(0, count * 2);
  }

  slice() {
    const fresh = this.pull(Math.min(SLICE_FRAMES, this.target - this.made));
    const count = fresh.length / 2;
    if (!count) {
      // WSOLA ran dry before the target: what is scheduled is all there is.
      this.made = this.target;
      if (!this.sources.length) this.onended?.();
      return;
    }
    const last = this.made + count >= this.target;
    const shared = this.tail ? this.tail.length / 2 : 0;
    const keep = last ? 0 : Math.min(SHARED_FRAMES, count);
    const frames = shared + count;
    const left = new Float32Array(frames);
    const right = new Float32Array(frames);
    const write = (samples, at) => {
      for (let i = 0; i < samples.length / 2; i++) {
        left[at + i] = samples[2 * i];
        right[at + i] = samples[2 * i + 1];
      }
    };
    if (this.tail) write(this.tail, 0);
    write(fresh, shared);
    // In over the frames the previous slice fades out on, and out over those
    // the next slice replays: the two gains always add up to one.
    for (let i = 0; i < shared; i++) {
      const gain = (i + 0.5) / shared;
      left[i] *= gain;
      right[i] *= gain;
    }
    for (let i = 0; i < keep; i++) {
      const gain = 1 - (i + 0.5) / keep;
      left[frames - keep + i] *= gain;
      right[frames - keep + i] *= gain;
    }
    this.tail = keep ? fresh.slice((count - keep) * 2) : null;
    const buffer = this.ctx.createBuffer(2, frames, this.sampleRate);
    buffer.copyToChannel(left, 0);
    buffer.copyToChannel(right, 1);
    const source = this.ctx.createBufferSource();
    source.buffer = buffer;
    source.connect(this.destination);
    // A slice made late (the page was busy) starts where playback is by now.
    const start = this.next - shared / this.sampleRate;
    const now = this.ctx.currentTime;
    source.start(Math.max(start, now), Math.max(0, now - start));
    this.sources.push(source);
    source.onended = () => {
      this.sources.splice(this.sources.indexOf(source), 1);
      if (!this.sources.length && this.made >= this.target) this.onended?.();
    };
    this.made += count;
    this.next += count / this.sampleRate;
  }
}
