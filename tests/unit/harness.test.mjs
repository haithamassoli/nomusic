import { test } from "node:test";
import assert from "node:assert/strict";
import vm from "node:vm";
import { Report, debugRequest } from "../harness.mjs";

function page() {
  const listeners = new Set(), timers = new Set(), messages = [];
  const window = {
    addEventListener: (type, fn) => listeners.add(fn),
    removeEventListener: (type, fn) => listeners.delete(fn),
    postMessage: (message) => messages.push(message),
  };
  const frame = { evaluate: (fn, args) => vm.runInNewContext(`(${fn}) (args)`, {
    args, window,
    setTimeout: (fn) => { timers.add(fn); return fn; }, clearTimeout: (fn) => timers.delete(fn),
  }) };
  return { frame, listeners, timers, messages };
}

for (const answered of [true, false]) {
  test(`a diagnostic request releases its listener and timer after ${answered ? "a reply" : "timing out"}`, async () => {
    const p = page();
    const result = debugRequest(p.frame, "state");
    if (answered) {
      const id = p.messages[0].id;
      for (const listener of p.listeners) listener({ data: { musicless: "debug-reply", id, reply: "ready" } });
    } else {
      for (const timeout of [...p.timers]) timeout();
    }
    assert.equal(await result, answered ? "ready" : undefined);
    assert.equal(p.listeners.size, 0);
    assert.equal(p.timers.size, 0);
  });
}

test("a report counts any result but a pass as a failure, a skip as neither, and a retried step once", () => {
  const report = new Report("unit");
  const log = console.log;
  console.log = () => {};
  try {
    report.record("passes", 1, {});
    for (const result of [null, undefined, 0]) report.record(`fails with ${result}`, result, { ok: true });
    report.skip("cannot run here", "no such thing");
    report.record("interrupted", false, { retried: true });
  } finally {
    console.log = log;
  }
  assert.deepEqual(report.summary(), { failed: true, text: "1/4 passed, 1 skipped" });
  assert.ok(report.rows.slice(1, 4).every((row) => row.ok === false), "details cannot pass a failure off");
});
