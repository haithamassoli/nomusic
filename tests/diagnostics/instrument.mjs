// Test-only hooks added to a disposable extension copy, never the shipped tree.
import { cpSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";

// What the page-world capture keeps, for the tests (the release has no way to
// read it). `media` counts kept audio other than format headers.
const CAPTURE_DEBUG = `window.__musiclessCaptureDebug = () => [...streams].map(([id, s]) => ({ id, url: s.url,
  buffers: [...s.buffers.values()], bytes: s.bytes, stored: s.log.length, subscribed: s.subscribed, dropped: !!s.dropped,
  missed: !!s.missed, media: s.log.reduce((sum, e) => sum + (e.kind === "append" && !e.header ? e.bytes.length : 0), 0), consented }));\n`;

// The test copy's requests for state and recordings (main.js). The recorder
// taps each routed session's audio; the release has neither.
const MAIN_DEBUG = `
// (test copy) state, sessions and recordings on request
const startSourceForTests = Session.prototype.startSource;
Session.prototype.startSource = function () {
  startSourceForTests.call(this);
  if (!this.graph || this.recorder) return;
  import("./recorder.js").then(({ Recorder }) => {
    if (!this.recorder && !this.disposed) this.recorder = new Recorder(this.graph.ctx, this.graph.element, this.graph.output, this.video);
  });
};
window.addEventListener("message", (event) => {
  if (event.source !== window || event.data?.musicless !== "debug") return;
  const sessions = [...controllers.values()].map((controller) => controller.session);
  const session = sessions.find((s) => s.attached) ?? sessions.find((s) => s.on) ?? sessions[0];
  let reply = null;
  if (event.data.type === "dump") reply = session?.recorder?.dump(event.data.seconds ?? 20) ?? null;
  else if (event.data.type === "state") reply = session ? session.snapshot() : null;
  else if (event.data.type === "sessions") reply = sessions.map((s) => s.snapshot());
  window.postMessage({ musicless: "debug-reply", id: event.data.id, reply }, "*");
});
`;

// Which model instance serves a frame, and how many tab workers it serves:
// the browser tests check that every tab shares one model.
const MODEL_DEBUG = `
// (test copy) this model's identity and the tab workers it serves
const modelForTests = { id: Math.random().toString(36).slice(2), clients: 0 };
const connectForTests = self.onconnect;
self.onconnect = (event) => {
  connectForTests(event);
  const serveClient = event.ports[0].onmessage;
  event.ports[0].onmessage = (message) => {
    if (message.data?.type === "client") modelForTests.clients++;
    if (message.data?.type === "test-model") event.ports[0].postMessage(modelForTests);
    else serveClient(message);
  };
};
`;

export function instrumentExtension(dir) {
  for (const file of ["recorder.js", "recorder-tap.js"]) cpSync(new URL(`./${file}`, import.meta.url), join(dir, file));
  const model = readFileSync(join(dir, "model-worker.js"), "utf8");
  if (!/^self\.onconnect = \(event\) => \{$/m.test(model)) throw new Error("model-worker.js no longer sets `self.onconnect`: update the harness");
  writeFileSync(join(dir, "model-worker.js"), model + MODEL_DEBUG);
  const capture = readFileSync(join(dir, "capture.js"), "utf8");
  const inspected = capture.replace(/^( *const streams = new Map\(\);.*\n)/m, `$1${CAPTURE_DEBUG}`)
    .replace(/^( *function trim\(stream, limit\) \{\n)/m, "$1    stream.dropped = true; // (test copy) older audio was let go\n");
  if (!inspected.includes(CAPTURE_DEBUG) || !inspected.includes("(test copy)")) {
    throw new Error("capture.js no longer declares `const streams = new Map();` or `function trim(stream, limit) {`: update the harness");
  }
  writeFileSync(join(dir, "capture.js"), inspected);
  const main = readFileSync(join(dir, "main.js"), "utf8");
  if (!/^import \{[^}]*\bSession\b[^}]*\} from "\.\/session\.js";$/m.test(main) || !main.includes("const controllers = new Map();")) {
    throw new Error("main.js no longer imports Session or declares `const controllers = new Map();`: update the harness");
  }
  writeFileSync(join(dir, "main.js"), main + MAIN_DEBUG);
}
