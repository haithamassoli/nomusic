import { test } from "node:test";
import assert from "node:assert/strict";
import { load, plain } from "./sandbox.mjs";

function storage() {
  let changed, finish, fail;
  let reads = 0;
  const mirror = load("settings.js", { chrome: { storage: {
    onChanged: { addListener: (listener) => { changed = listener; } },
    sync: { get: () => { reads++; return new Promise((resolve, reject) => { finish = resolve; fail = reject; }); } },
  } } });
  return {
    ...mirror,
    reads: () => reads,
    change: (values, area = "sync") => changed(values, area),
    finish: (values) => finish(values), fail: () => fail(new Error("Extension context invalidated")),
  };
}

test("importing settings does not access storage; consumers share one initial read", async () => {
  const s = storage();
  assert.equal(s.reads(), 0);
  const first = s.loadSettings(), second = s.loadSettings();
  assert.equal(s.reads(), 1);
  s.finish({ consented: true, autoStart: false });
  assert.equal(await first, await second);
  assert.deepEqual(plain(s.settings), { autoStart: false, consented: true });
});

test("a newer consent change wins over an older initial storage read", async () => {
  const s = storage();
  const loading = s.loadSettings();
  s.change({ consented: { newValue: true } });
  s.finish({ consented: false, autoStart: false });
  await loading;
  assert.deepEqual(plain(s.settings), { consented: true, autoStart: false });
});

test("listeners hear changes only after the first read, which includes earlier ones", async () => {
  const s = storage(), seen = [];
  s.onSettingsChanged(value => seen.push(plain(value)));
  const loading = s.loadSettings();
  s.change({ autoStart: { newValue: false } });
  assert.equal(seen.length, 0, "a half-read state (consent still at its default) must not be announced");
  s.finish({ consented: true, autoStart: true });
  assert.deepEqual(plain(await loading), { autoStart: false, consented: true });
  s.change({ autoStart: { newValue: true } });
  assert.deepEqual(seen, [{ autoStart: true, consented: true }]);
});

test("deleting a setting during initialization restores its default, not the old value", async () => {
  const s = storage();
  const loading = s.loadSettings();
  s.change({ consented: {} });
  s.finish({ consented: true, autoStart: false });
  await loading;
  assert.equal(s.settings.consented, false);
});

test("sync changes notify subscribers; unrelated storage and unsubscribed listeners do not", async () => {
  const s = storage(), seen = [];
  const stop = s.onSettingsChanged(value => seen.push(plain(value)));
  const loading = s.loadSettings(); s.finish({}); await loading;
  s.change({ consented: { newValue: true } }, "session");
  s.change({ videoTab: { newValue: {} } });
  assert.equal(seen.length, 0);
  s.change({ autoStart: { newValue: false } });
  stop();
  s.change({ consented: { newValue: true } });
  assert.deepEqual(seen, [{ autoStart: false, consented: false }]);
  assert.equal(s.settings.consented, true);
});

test("unavailable storage leaves consent off, or preserves a value already observed", async () => {
  for (const observed of [false, true]) {
    const s = storage();
    const loading = s.loadSettings();
    if (observed) s.change({ consented: { newValue: true } });
    s.fail(); await loading;
    assert.equal(s.settings.consented, observed);
  }
});
