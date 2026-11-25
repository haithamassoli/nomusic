import { test } from "node:test";
import assert from "node:assert/strict";
import { analyze, synthesize } from "../../landing/audio/dsp.js";
import { applyFades, BINS, FRAMES, HOP, N_FFT, OVERLAP_SAMPLES, RATE, STRIDE_SAMPLES, WINDOW_SAMPLES } from "../../landing/audio/grid.js";

const PLANE = FRAMES * BINS;
const noise = (length, seed) => {
  let state = seed;
  return new Float32Array(length).map(() => {
    state = (state * 1664525 + 1013904223) >>> 0;
    return state / 2 ** 31 - 1;
  });
};

test("the website grid matches the model's 513 x 2049 input", () => {
  assert.deepEqual([FRAMES, BINS, WINDOW_SAMPLES, STRIDE_SAMPLES, OVERLAP_SAMPLES], [513, 2049, 524288, 522240, 2048]);
  assert.equal(RATE, 44100);
});

test("an unchanged spectrum gives back the whole window, edges included", () => {
  const left = noise(WINDOW_SAMPLES, 1);
  const right = noise(WINDOW_SAMPLES, 2);
  const out = synthesize(analyze(left, right));
  let worst = 0;
  for (let i = 0; i < WINDOW_SAMPLES; i++) {
    worst = Math.max(worst, Math.abs(out.left[i] - left[i]), Math.abs(out.right[i] - right[i]));
  }
  assert.ok(worst < 1e-5, `max error ${worst}`);
});

test("the planes are left re, left im, right re, right im of a forward DFT", () => {
  const left = noise(WINDOW_SAMPLES, 3);
  const right = noise(WINDOW_SAMPLES, 4);
  const x = analyze(left, right);
  const frame = 100;
  const origin = frame * HOP - N_FFT / 2;
  for (const k of [0, 1, 700, 2048]) {
    const sums = [0, 0, 0, 0];
    for (let n = 0; n < N_FFT; n++) {
      const w = Math.sqrt(0.5 - 0.5 * Math.cos((2 * Math.PI * n) / N_FFT));
      const angle = (-2 * Math.PI * k * n) / N_FFT;
      sums[0] += left[origin + n] * w * Math.cos(angle);
      sums[1] += left[origin + n] * w * Math.sin(angle);
      sums[2] += right[origin + n] * w * Math.cos(angle);
      sums[3] += right[origin + n] * w * Math.sin(angle);
    }
    for (let p = 0; p < 4; p++) {
      const got = x[p * PLANE + frame * BINS + k];
      assert.ok(Math.abs(got - sums[p]) < 1e-3 * (1 + Math.abs(sums[p])), `plane ${p} bin ${k}: ${got} vs ${sums[p]}`);
    }
  }
});

test("a silent spectrum gives silence", () => {
  const out = synthesize(new Float32Array(4 * PLANE));
  assert.ok(out.left.every((v) => v === 0) && out.right.every((v) => v === 0));
});

test("neighbouring windows crossfade to exactly the input", () => {
  const ones = () => [new Float32Array(WINDOW_SAMPLES).fill(1)];
  const [first] = ones();
  const [second] = ones();
  applyFades([first], 0);
  applyFades([second], 1);
  assert.equal(first[0], 1, "the first window does not fade in");
  for (let i = 0; i < OVERLAP_SAMPLES; i++) {
    assert.ok(Math.abs(first[STRIDE_SAMPLES + i] + second[i] - 1) < 1e-6);
  }
});
