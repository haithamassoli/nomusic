// The website's music-removal model, stored in R2 under its own hash. Never
// overwrite a hashed object: a new model gets a new URL.
export const MODEL_SHA256 = '057482844476ac17c113c18c71ac1fa061ee3fd8fdd5805dbd9610e38d19661a';
export const MODEL_BYTES = 49578685;
export const MODEL_URL = `https://files.ieasybooks.com/musicless/models/musicless-${MODEL_SHA256}.onnx`;
export const MAX_BYTES = 100 * 1024 * 1024;
export const MAX_SECONDS = 10 * 60;
export const CACHE_NAME = 'musicless-models-v1';
