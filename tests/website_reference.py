"""Offline website model exactly as the browser tool runs it (landing/audio/grid.js, dsp.js).

Windows of 524288 samples start every 522240 samples from the start of the file.
Each window gets a reflect-padded, centred STFT (n_fft 4096, hop 1024, periodic
square-root Hann, all 2049 bins); the model reads the spectrum as it is and
returns the spectrum without the music; the inverse STFT uses the same window;
and neighbouring windows crossfade linearly over their 2048-sample overlap.
Needs numpy and onnxruntime only. The model file is a parameter: the tests
download it from R2 and check its hash.
"""

import numpy as np
import onnxruntime as ort

N_FFT, HOP = 4096, 1024
WINDOW = 512 * HOP
FRAMES = WINDOW // HOP + 1
OVERLAP = 2 * HOP
STRIDE = WINDOW - OVERLAP
SQRT_HANN = np.sqrt(0.5 - 0.5 * np.cos(2 * np.pi * np.arange(N_FFT) / N_FFT))
_INDEX = np.arange(FRAMES)[:, None] * HOP + np.arange(N_FFT)[None, :]
_sessions = {}


def stft(block):
    """(2, WINDOW) samples -> (2, FRAMES, 2049) complex spectrum."""
    padded = np.pad(block, ((0, 0), (N_FFT // 2, N_FFT // 2)), mode="reflect")
    return np.fft.rfft(padded[:, _INDEX] * SQRT_HANN, axis=-1)


def istft(spec):
    """(2, FRAMES, 2049) -> (2, WINDOW), overlap-added with window^2 normalization."""
    frames = np.fft.irfft(spec, n=N_FFT, axis=-1) * SQRT_HANN
    out = np.zeros((2, WINDOW + N_FFT))
    weight = np.zeros(WINDOW + N_FFT)
    for f in range(FRAMES):
        out[:, f * HOP : f * HOP + N_FFT] += frames[:, f]
        weight[f * HOP : f * HOP + N_FFT] += SQRT_HANN**2
    weight = weight[N_FFT // 2 : N_FFT // 2 + WINDOW]
    return out[:, N_FFT // 2 : N_FFT // 2 + WINDOW] / np.where(weight > 1e-11, weight, 1)


def voices(stereo, model):
    """(samples, 2) float audio at 44.1 kHz -> the audio without the music, same shape."""
    if model not in _sessions:
        _sessions[model] = ort.InferenceSession(model, providers=["CPUExecutionProvider"])
    x = np.asarray(stereo, np.float64).T
    n = x.shape[1]
    out = np.zeros((2, n + WINDOW))
    rise = (np.arange(OVERLAP) + 0.5) / OVERLAP
    for k, start in enumerate(range(0, n, STRIDE)):
        block = np.zeros((2, WINDOW))
        segment = x[:, start : start + WINDOW]
        block[:, : segment.shape[1]] = segment
        spec = stft(block)
        planes = np.stack([spec[0].real, spec[0].imag, spec[1].real, spec[1].imag])[None].astype(np.float32)
        y = _sessions[model].run(None, {"x": planes})[0][0].astype(np.float64)
        y = istft(np.stack([y[0] + 1j * y[1], y[2] + 1j * y[3]]))
        if k > 0:
            y[:, :OVERLAP] *= rise
        y[:, -OVERLAP:] *= 1 - rise
        out[:, start : start + WINDOW] += y
    return out[:, :n].T
