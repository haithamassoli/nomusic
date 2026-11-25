// The website's music-removal model on ONNX Runtime Web (WebAssembly, one CPU
// thread). build.mjs copies this file as is, next to the pinned runtime in
// vendor/, so the worker loads both only once a run starts.

import * as ort from './vendor/ort.wasm.min.mjs';

ort.env.wasm.numThreads = 1;
ort.env.wasm.proxy = false;
ort.env.wasm.wasmPaths = new URL('./vendor/', import.meta.url).href;
ort.env.logLevel = 'error';

// One window's spectrum: [left re, left im, right re, right im] x 513 frames x
// 2049 bins (../grid.js). The output `y` has the same layout.
export const SHAPE = [1, 4, 513, 2049];

// bytes: the verified model file. Resolves to { run(spectrum) -> Float32Array }.
export async function createModel(bytes) {
  const session = await ort.InferenceSession.create(bytes, {
    executionProviders: ['wasm'],
    graphOptimizationLevel: 'all',
  });
  return {
    async run(spectrum) {
      const { y } = await session.run({ x: new ort.Tensor('float32', spectrum, SHAPE) });
      return y.data;
    },
  };
}
