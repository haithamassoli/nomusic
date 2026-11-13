import { test } from "node:test";
import assert from "node:assert/strict";
import { load } from "./sandbox.mjs";

const { createFailure } = load("failures.js", { t: (key) => key });

test("each failure offers what can help: nothing more, a page reload, or another try", () => {
  const offers = {
    protected: null, codec: null, source: null,
    missed: "reload", uncaptured: "reload", engine: "reload", audio: "reload", updated: "reload",
    slow: "retry", error: "retry",
  };
  for (const [reason, action] of Object.entries(offers)) {
    const failure = createFailure(reason, "detail");
    assert.equal(failure.reason, reason);
    assert.equal(failure.action, action, reason);
    assert.equal(failure.message, `failure_${reason}`, reason);
    assert.equal(failure.title, reason === "missed" ? "done_heading" : "panel_title", reason);
    assert.equal(failure.describe, reason !== "error", reason);
    assert.equal(failure.detail, "detail");
  }
});

test("a reason without a policy shows the generic message and offers another try", () => {
  const failure = createFailure("new");
  assert.deepEqual([failure.action, failure.title, failure.message, failure.describe, failure.detail],
    ["retry", "panel_title", "failure_error", true, null]);
});
