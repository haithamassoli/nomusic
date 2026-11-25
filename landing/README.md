# Musicless landing page

The static site for `musicless.ieasybooks.com` has English and Arabic pages,
with tabs for the YouTube extension and local audio processing.

## Local preview

Run these commands from the repository root with Node.js 22 or newer.

```sh
npm ci
npm run build:landing
npm run preview:landing
```

Open `http://localhost:8840/`. It opens in Arabic when the browser's primary
language is Arabic and in English otherwise. Use `/en/` or `/ar/` to preview
a specific language. Set `PORT` to change the preview port.
Open `/en/#files` or `/ar/#files` to go straight to the audio tool.
No backend, R2 credentials, or local model build is needed to use the site.

## Editing the page

Edit the English and Arabic text, store links, and YouTube video IDs in
[content.mjs](content.mjs). Rebuild the site to see your changes.
The audio tool's copy and FAQ are in [audio/copy.js](audio/copy.js).

The About, Privacy policy, Terms of use and Contact & support pages
(`/en/about`, `/en/privacy`, `/en/terms`, `/en/support` and the same under
`/ar/`) are built from [pages.txt](pages.txt), the approved text, one block per
page and language: line 1 is the title, line 2 the lead paragraph, `## ` starts
a section heading and every other line is a paragraph. Links are
`[label](href)`, and `tab:privacy` links to the privacy policy in the same
language. The **Last updated** line of the privacy policy and terms is in
[content.mjs](content.mjs). Change their text only to an approved version, and
update `tests/fixtures/landing-pages.txt` to match: the landing tests compare
every page with it word for word.

Each page shows a local poster. Selecting it loads that language's launch video
in YouTube's privacy-enhanced player. The link below opens the video on YouTube.

## Audio processing

- MP3 → MP3; M4A containing AAC → M4A containing AAC-LC. Mono/stereo only,
  up to 10 minutes and 100 MiB, input sample rates 8–96 kHz. Output is 44.1 kHz,
  96 kbps mono or 192 kbps stereo. The model preserves speech and singing;
  separation may leave music or affect voice quality. Metadata/artwork are not copied.
- Capability detection runs in the worker: secure context, WebAssembly SIMD,
  WebCodecs audio decoding, and the actual file's decoder configuration. There
  is no browser-name allowlist. M4A with Apple Lossless, video, multitrack,
  protected/unreadable files and other formats receive an explanation.
- File selection inspects the container/codec/duration with MediaBunny. Submit
  checks the output settings, lazily registers the official MediaBunny MP3 or
  AAC WASM encoder when the native encoder is unavailable, and performs a real
  short decode/encode before downloading the model.
- The website has its own music-removal model, separate from the extension's
  Spleeter: a 47.3 MiB ONNX graph (12M float32 weights, band-split recurrent
  layers) that reads the full-band complex spectrum of a stereo window and
  returns that spectrum without the music. It comes from the existing
  `ieasybooks` R2 bucket via
  `https://files.ieasybooks.com/musicless/models/musicless-<sha256>.onnx`.
  [audio/config.js](audio/config.js) pins its hash and exact size. SHA-256 is
  checked on both network and cached bytes. CacheStorage is best effort;
  eviction, disabled storage and corrupt cache entries trigger a fresh fetch.
  Once a new model is cached, older ones are deleted from the cache.
- The dedicated worker runs it on single-thread ORT WASM with
  [audio/grid.js](audio/grid.js) and [audio/dsp.js](audio/dsp.js): 44.1 kHz,
  ~11.9-second windows on a fixed grid from the start of the file, a centred
  STFT (n_fft 4096, hop 1024, square-root Hann, all 2049 bins) at the audio's
  own level, and a 46 ms crossfade between windows. Mono files are separated as
  identical left and right channels. Each window takes about 3× the CPU time
  Spleeter needs (about 4 s on a mid-range desktop), so a 10-minute file takes
  a few minutes. Decoding is
  bounded to one window plus resampling margins. Export is incremental; only
  compressed output is retained.
- Multithreading would need cross-origin isolation headers, which would block
  the home page's YouTube player, and the model's recurrent layers gain little
  from more threads, so the tool stays single-threaded.
- Cancel terminates the worker, including child encoder workers and pending
  downloads. Completion also terminates it to release WASM memory. Preview and
  download use local Blob URLs, revoked on reset or leaving the page.
- Files and filenames are never sent over the network. Only static tools/model
  assets are fetched. A warm cache does not imply guaranteed offline availability.

## Model publishing

Pass the model file to the script and provide a Cloudflare API token that can
write the `ieasybooks` bucket through the environment. From the sibling
infrastructure repository, the vault supplies Terraform's token for one run:

```sh
mise run vault:run INFRASTRUCTURE_CLOUDFLARE_API_TOKEN=CLOUDFLARE_API_TOKEN -- \
  node ../musicless/tools/upload-model.mjs path/to/model.onnx
```

The script verifies the file against the pinned hash, uploads to the hashed object key with
`Cache-Control: public, max-age=31536000, immutable`, then downloads it to
verify its hash and CORS. It does not deploy the website. Never put tokens in
source files or command arguments.

The sibling infrastructure repository manages the bucket's GET/HEAD CORS and
the narrow `/musicless/models/` cache rule for `files.ieasybooks.com`. Model keys
must remain content-addressed. Update the pin and publish a new key when weights
change, before merging. The deployment checks the pinned model in R2 first. Keep
old model objects for already-open pages.

## Tests

After `./setup.sh --dev` and installing FFmpeg:

```sh
cd tests
npm run unit
cd ..
npm run test:landing
```

The landing suite builds and serves on port 8841 (override with
`LANDING_TEST_PORT`), launches Chrome (`CHROME` can override the executable),
and downloads the actual R2 model. Set `FIREFOX=/path/to/firefox` to run the same
suite in Firefox instead. It uses synthetic audio to check real MP3
and AAC M4A downloads, duration/channels, audio agreement with the Python
reference, native and WASM encoders, caching, retries, cancellation, validation,
capability gating and English/Arabic responsive layouts. It also checks the
About, Privacy policy, Terms of use and Contact & support pages against the
approved text, with their links, footer, sitemap entries and layout.
Artifacts stay ignored under `tests/.work/landing`. The site never needs this
test environment.
Set `LANDING_LONG=1` to also process and verify a full 10-minute file.

## Deployment

On Cloudflare Pages, use the repository root as the build root,
`npm ci && npm run build:landing` as the build command, and `dist/landing` as the
output directory. On another static host, publish the contents of that
directory and serve `index.html` for `/`, `/en/`, and `/ar/`, and
`en/privacy.html` and the other pages at `/en/privacy` and so on, without a
redirect.
Serve `.mjs` as JavaScript and `.wasm` as `application/wasm`. HTTPS is required
outside localhost. The build fetches the pinned ORT package with SHA-256
verification if `setup.sh` has not supplied it locally. It does not bundle the
model into Pages or need Python. No cross-origin isolation headers are required
for the single-thread runtime. License texts, upstream sources and codec build
instructions are published in `/licenses/THIRD_PARTY.md` and adjacent files.
