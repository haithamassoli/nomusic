// The pitch-preserving stretch (stretch.js) as it is played: slices scheduled
// back to back, against a stand-in context that keeps what was scheduled.
import { test } from "node:test";
import assert from "node:assert/strict";
import { SHARED_FRAMES, SLICE_FRAMES, StretchedPlayback } from "../../extension/stretch.js";

const RATE = 44100;

function buffer(left, right = left) {
  const data = [left, right];
  return {
    length: left.length, sampleRate: RATE, numberOfChannels: 2, duration: left.length / RATE,
    copyFromChannel(target, channel, from = 0) { target.set(data[channel].subarray(from, from + target.length)); },
    // Firefox detaches the arrays this gave out once the buffer plays: never read them.
    getChannelData() { throw new Error("getChannelData: its arrays may be detached"); },
  };
}

// Where each slice's new frames begin, in output frames.
const sliceStarts = (count) => Array.from({ length: count }, (_, i) => i * SLICE_FRAMES);

function context() {
  const ctx = {
    currentTime: 0,
    scheduled: [],
    createBuffer: (channels, length) => {
      const data = Array.from({ length: channels }, () => new Float32Array(length));
      return { length, data, copyToChannel(source, channel) { data[channel].set(source); } };
    },
    createBufferSource() {
      const source = { connect() {}, disconnect() {}, stop() {}, start: (when, offset = 0) => ctx.scheduled.push({ buffer: source.buffer, when, offset }) };
      return source;
    },
  };
  return ctx;
}

// A voice-like test signal: a few harmonics with a slow pitch glide, at a speaking level.
function voice(frames) {
  const out = new Float32Array(frames);
  let phase = 0;
  for (let i = 0; i < frames; i++) {
    const f0 = 140 + 40 * Math.sin((2 * Math.PI * i) / RATE / 1.3);
    phase += (2 * Math.PI * f0) / RATE;
    out[i] = 0.2 * (Math.sin(phase) + 0.5 * Math.sin(2 * phase) + 0.25 * Math.sin(3 * phase));
  }
  return out;
}

// What the context will play, as one timeline from `start` (left channel).
function timeline(ctx, start, frames) {
  const out = new Float64Array(frames);
  for (const { buffer: b, when, offset } of ctx.scheduled) {
    const at = Math.round((when - start) * RATE) - Math.round(offset * RATE);
    for (let i = Math.round(offset * RATE); i < b.length; i++) if (at + i >= 0 && at + i < frames) out[at + i] += b.data[0][i];
  }
  return out;
}

test("back-to-back slices play exactly the stretched voice, with no seam", () => {
  const input = voice(RATE * 4);
  const ctx = context();
  const playback = new StretchedPlayback(buffer(input), 0.5, 1.5, 1, { context: ctx });
  playback.fill(Infinity);
  assert.equal(playback.made, playback.target);
  assert.equal(playback.target, Math.ceil((input.length - 0.5 * RATE) / 1.5));
  assert.ok(ctx.scheduled.length > 3);
  assert.equal(ctx.scheduled[0].when, 1, "starts when asked");
  for (let i = 1; i < ctx.scheduled.length; i++) {
    const previous = ctx.scheduled[i - 1];
    const ends = previous.when + previous.buffer.length / RATE;
    assert.ok(Math.abs(ctx.scheduled[i].when - (ends - SHARED_FRAMES / RATE)) < 1e-9, `slice ${i} overlaps the last by ${SHARED_FRAMES} frames`);
  }
  // The same stream in one piece: slicing and crossfading must not change a sample.
  const whole = new StretchedPlayback(buffer(input), 0.5, 1.5, 1, { context: context() }).pull(playback.target);
  const played = timeline(ctx, 1, playback.target);
  let worst = 0;
  for (let i = 0; i < playback.target; i++) worst = Math.max(worst, Math.abs(played[i] - whole[2 * i]));
  assert.ok(worst < 1e-6, `largest difference ${worst}`);
  // And it is the voice, shortened and audible throughout.
  const rms = (from, to) => Math.sqrt(played.slice(from, to).reduce((sum, x) => sum + x * x, 0) / (to - from));
  for (let at = 0; at + RATE / 4 <= playback.target; at += RATE / 4) assert.ok(rms(at, at + RATE / 4) > 0.05, `quiet at ${at}`);
});

test("slices are made as far as asked, and no further", () => {
  const ctx = context();
  const playback = new StretchedPlayback(buffer(voice(RATE * 12)), 0, 1.5, 0, { context: ctx });
  playback.fill(0.01);
  assert.equal(ctx.scheduled.length, 1);
  assert.equal(ctx.scheduled[0].buffer.length, SLICE_FRAMES);
  const count = (until) => sliceStarts(40).filter((frame) => frame / RATE < until).length;
  playback.fill(0.75);
  assert.equal(ctx.scheduled.length, count(0.75));
  playback.fill(0.75);
  assert.equal(ctx.scheduled.length, count(0.75), "nothing more for the same time");
  playback.stop(0.5);
  playback.fill(5);
  assert.equal(ctx.scheduled.length, count(0.75), "nothing after a stop");
});

test("a slice made late starts where playback is by then", () => {
  const ctx = context();
  const playback = new StretchedPlayback(buffer(voice(RATE * 4)), 0, 1.5, 0, { context: ctx });
  playback.fill(0.01);
  ctx.currentTime = 0.5; // the page was busy: the second slice was due at about 0.37 s
  playback.fill(0.6);
  const late = ctx.scheduled[1];
  assert.equal(late.when, 0.5);
  const due = SLICE_FRAMES / RATE - SHARED_FRAMES / RATE;
  assert.ok(Math.abs(late.offset - (0.5 - due)) < 1e-9, `skips what is past, ${late.offset}`);
});

test("it has ended once all of it has played, and not when stopped before it was all made", () => {
  const ctx = context();
  const sources = [];
  const createBufferSource = ctx.createBufferSource;
  ctx.createBufferSource = () => {
    const source = createBufferSource();
    sources.push(source);
    return source;
  };
  let ended = 0;
  const whole = new StretchedPlayback(buffer(voice(RATE)), 0, 1.5, 0, { context: ctx });
  whole.onended = () => ended++;
  whole.fill(10);
  assert.equal(whole.made, whole.target);
  for (const source of sources.slice(0, -1)) source.onended();
  assert.equal(ended, 0, "a slice still plays");
  sources.at(-1).onended();
  assert.equal(ended, 1);
  sources.length = 0;
  const stopped = new StretchedPlayback(buffer(voice(RATE * 12)), 0, 1.5, 0, { context: ctx });
  stopped.onended = () => ended++;
  stopped.fill(0.8);
  stopped.stop(0);
  for (const source of sources) source.onended();
  assert.equal(ended, 1, "stopped, not ended");
});
