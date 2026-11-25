// The website model's window grid and STFT settings (tests/website_reference.py
// mirrors them). Windows of WINDOW_SAMPLES start every STRIDE_SAMPLES from the
// start of the file. Neighbouring windows overlap by OVERLAP_SAMPLES and
// crossfade, because independently separated windows disagree at their edges.

export const RATE = 44100;
export const N_FFT = 4096;
export const HOP = 1024;
export const WINDOW_SAMPLES = 512 * HOP; // 524288 samples (11.9 s) per window
export const FRAMES = WINDOW_SAMPLES / HOP + 1; // 513 centred STFT frames
export const BINS = N_FFT / 2 + 1; // 2049: every bin, up to 22.05 kHz
export const OVERLAP_SAMPLES = 2 * HOP; // 2048 samples (46 ms) of crossfade
export const STRIDE_SAMPLES = WINDOW_SAMPLES - OVERLAP_SAMPLES;

// Linear crossfade weights: a window's fade-out and the next one's fade-in sum to 1.
export function applyFades(channels, k) {
  for (const samples of channels) {
    const length = samples.length;
    for (let i = 0; i < OVERLAP_SAMPLES; i++) {
      const rise = (i + 0.5) / OVERLAP_SAMPLES;
      if (k > 0) samples[i] *= rise;
      samples[length - OVERLAP_SAMPLES + i] *= 1 - rise;
    }
  }
}
