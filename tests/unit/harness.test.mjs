import { test } from "node:test";
import assert from "node:assert/strict";
import vm from "node:vm";
import { debugRequest } from "../harness.mjs";

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
