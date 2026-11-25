// The website's music-removal model on ONNX Runtime Web (WebAssembly, one CPU
// thread). build.mjs copies this file as is, next to the pinned runtime in
// vendor/ and the music detector, so the worker loads them only once a run starts.

import * as ort from './vendor/ort.wasm.min.mjs';

ort.env.wasm.numThreads = 1;
ort.env.wasm.proxy = false;
ort.env.wasm.wasmPaths = new URL('./vendor/', import.meta.url).href;
ort.env.logLevel = 'error';

// One window's spectrum: [left re, left im, right re, right im] x 513 frames x
// 2049 bins (../grid.js). The output `y` has the same layout.
export const SHAPE = [1, 4, 513, 2049];
// The detector reads [mid, side] x 513 frames x 48 bands (musicFeatures in
// ../dsp.js) and scores music for every 8 frames. Its threshold is folded into
// the scores (tools/detector.py): music is likely where a score is >= 0.
const DETECTOR_SHAPE = [1, 2, 513, 48];
const options = { executionProviders: ['wasm'], graphOptimizationLevel: 'all' };

// bytes: the verified model file. Resolves to { run(spectrum) -> Float32Array,
// score(features) -> the window's highest detector score }. The detector only
// saves time: without it, every window scores Infinity and is separated.
export async function createModel(bytes) {
  const session = await ort.InferenceSession.create(bytes, options);
  const detector = await ort.InferenceSession.create(new URL('./detector.onnx', import.meta.url).href, options)
    .catch(error => { console.error('Musicless audio: music detector unavailable', error); return null; });
  return {
    async run(spectrum) {
      const { y } = await session.run({ x: new ort.Tensor('float32', spectrum, SHAPE) });
      return y.data;
    },
    async score(features) {
      if (!detector) return Infinity;
      const { y } = await detector.run({ x: new ort.Tensor('float32', features, DETECTOR_SHAPE) });
      return Math.max(...y.data);
    },
  };
}
