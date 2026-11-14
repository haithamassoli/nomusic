#!/usr/bin/env bash
# Package the extension for release: dist/musicless-<version>.zip, the archive
# to upload to the Chrome Web Store (and Edge Add-ons) or to share for "Load
# unpacked", and dist/musicless-<version>-firefox.zip for Firefox Add-ons: the
# same files with Firefox's manifest (see firefox_manifest below).
# Run ./setup.sh first: the model and the runtime are built, not committed.
# The zip holds the files git tracks in extension/ plus the built files,
# so nothing else in the folder can slip in. In a source archive (git
# archive, as submitted to Mozilla) the files in extension/ are the tracked
# ones. Test diagnostics live under tests/. Sorted entries and fixed
# timestamps make the archive reproducible.
set -euo pipefail
cd "$(dirname "$0")/.."

# Always rebuild: source changes cannot leave a stale content script in the ZIP.
npm run build

python3 - <<'PY'
import hashlib, json, os, subprocess, sys, zipfile

BUILT = ["content.bundle.js", "model/spleeter-2stems.onnx", "vendor/ort.wasm.min.mjs",
         "vendor/ort-wasm-simd-threaded.mjs", "vendor/ort-wasm-simd-threaded.wasm"]
for name in BUILT:
    if not os.path.isfile(os.path.join("extension", name)):
        sys.exit(f"Missing extension/{name}: run ./setup.sh first.")
if os.path.exists(".git"):
    listed = subprocess.run(["git", "ls-files", "-z", "extension"], check=True, capture_output=True, text=True).stdout
    tracked = {os.path.relpath(path, "extension") for path in listed.split("\0") if path}
else:
    tracked = {os.path.relpath(os.path.join(folder, name), "extension")
               for folder, _, names in os.walk("extension") for name in names}
    tracked = {name for name in tracked if not name.startswith(("model/", "vendor/", ".")) and "/." not in name}
files = sorted(tracked | set(BUILT))

# Only the tested build goes out: the model setup.sh builds, and no test key.
manifest = json.load(open("extension/manifest.json"))
if "musicless_test" in manifest:
    sys.exit("extension/manifest.json has the test harness's musicless_test key.")
expected = json.load(open("tools/dependencies.json"))["model_sha256"]
model = hashlib.sha256(open("extension/model/spleeter-2stems.onnx", "rb").read()).hexdigest()
if model != expected:
    sys.exit(f"extension/model/spleeter-2stems.onnx is not the model setup.sh builds (sha256 {model}).")

# Firefox runs background.scripts (an event page) where Chrome runs the
# service worker. It needs an add-on ID, which can never change once on Firefox
# Add-ons, and new add-ons declare what data they collect: none. 140 is the
# first Firefox with that declaration; main-world content scripts (128) and
# WebCodecs audio decoding (130) came before it.
def firefox_manifest(chrome):
    firefox = {}
    for key, value in chrome.items():
        if key == "minimum_chrome_version":
            continue
        if key == "background":
            value = {"scripts": [value["service_worker"]], "type": value["type"]}
        firefox[key] = value
    firefox["browser_specific_settings"] = {"gecko": {
        "id": "musicless@ieasybooks",
        "strict_min_version": "140.0",
        "data_collection_permissions": {"required": ["none"]},
    }}
    return (json.dumps(firefox, indent=2, ensure_ascii=False) + "\n").encode()

def package(out, manifest_json=None):
    with zipfile.ZipFile(out, "w", zipfile.ZIP_DEFLATED, compresslevel=9) as archive:
        for name in files:
            info = zipfile.ZipInfo(name, date_time=(1980, 1, 1, 0, 0, 0))
            info.external_attr = 0o644 << 16
            info.compress_type = zipfile.ZIP_DEFLATED
            if name == "manifest.json" and manifest_json:
                data = manifest_json
            else:
                with open(os.path.join("extension", name), "rb") as source:
                    data = source.read()
            archive.writestr(info, data, compresslevel=9)
    digest = hashlib.sha256(open(out, "rb").read()).hexdigest()
    size = os.path.getsize(out) / 2**20
    print(f"{out}: {len(files)} files, {size:.1f} MiB\nsha256 {digest}")

version = manifest["version"]
os.makedirs("dist", exist_ok=True)
unpacked = sum(os.path.getsize(os.path.join("extension", name)) for name in files) / 2**20
print(f"{len(files)} files, {unpacked:.1f} MiB unpacked")
package(f"dist/musicless-{version}.zip")
package(f"dist/musicless-{version}-firefox.zip", firefox_manifest(manifest))
PY
