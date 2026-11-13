#!/usr/bin/env bash
# Build the large files the extension needs (they are not committed), checking
# every download against a pinned SHA-256:
#   extension/model/spleeter-2stems.onnx  Spleeter 2-stem (Deezer, MIT), built from
#                                         sherpa-onnx's ONNX export by tools/build_model.py
#   extension/vendor/                     ONNX Runtime Web (Microsoft, MIT), WebAssembly build
# Versions, URLs and hashes: tools/dependencies.json.
# Also bundles the content script with pinned build-only esbuild.
# Needs Node.js/npm, curl, tar and python3 (a throwaway venv gets onnx and numpy).
#
# ./setup.sh --dev also installs the test tools: tests/node_modules (puppeteer-core)
# with npm, and tests/.venv (numpy, onnxruntime) for the analysis.
set -euo pipefail
cd "$(dirname "$0")"

DEV=0
[[ "${1:-}" == "--dev" ]] && DEV=1

npm ci --no-audit --no-fund
npm run build

read -r SPLEETER_URL SPLEETER_SHA256 ORT_VERSION ORT_SHA256 MODEL_SHA256 < <(python3 - <<'PY'
import json
with open("tools/dependencies.json") as source:
    pins = json.load(source)
print(*(pins[key] for key in ("spleeter_url", "spleeter_sha256", "ort_version", "ort_sha256", "model_sha256")))
PY
)
ORT_URL=https://registry.npmjs.org/onnxruntime-web/-/onnxruntime-web-$ORT_VERSION.tgz

work=$(mktemp -d)
trap 'rm -rf "$work"' EXIT

sha256() {
  if command -v sha256sum >/dev/null; then sha256sum "$1" | cut -d' ' -f1; else shasum -a 256 "$1" | cut -d' ' -f1; fi
}

fetch() { # url, output file, expected sha256
  curl -fsSL --retry 3 -o "$2" "$1"
  if [[ "$(sha256 "$2")" != "$3" ]]; then
    echo "Checksum mismatch for $1" >&2
    exit 1
  fi
}

echo "Downloading Spleeter 2-stem (sherpa-onnx's export of Deezer's MIT-licensed weights)..."
fetch "$SPLEETER_URL" "$work/spleeter.tar.bz2" "$SPLEETER_SHA256"
mkdir "$work/spleeter"
tar -xjf "$work/spleeter.tar.bz2" -C "$work/spleeter" --strip-components=1
python3 -m venv "$work/venv"
"$work/venv/bin/pip" install --quiet --disable-pip-version-check -r tools/model-requirements.txt
mkdir -p extension/model
"$work/venv/bin/python" tools/build_model.py "$work/spleeter" extension/model/spleeter-2stems.onnx
if [[ "$(sha256 extension/model/spleeter-2stems.onnx)" != "$MODEL_SHA256" ]]; then
  echo "The built model differs from the tested one (expected sha256 $MODEL_SHA256)." >&2
  exit 1
fi

echo "Downloading ONNX Runtime Web $ORT_VERSION..."
fetch "$ORT_URL" "$work/ort.tgz" "$ORT_SHA256"
tar -xzf "$work/ort.tgz" -C "$work" package/dist
rm -rf extension/vendor
mkdir -p extension/vendor
for file in ort.wasm.min.mjs ort-wasm-simd-threaded.mjs ort-wasm-simd-threaded.wasm; do
  cp "$work/package/dist/$file" extension/vendor/
done

if [[ $DEV == 1 ]]; then
  echo "Installing test tools..."
  (cd tests && npm ci --no-audit --no-fund)
  python3 -m venv tests/.venv
  tests/.venv/bin/pip install --quiet --disable-pip-version-check -r tests/requirements.txt
fi
echo "Done. Load the extension folder as an unpacked extension (chrome://extensions, Developer mode)."
