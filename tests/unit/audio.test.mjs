// The page's shared AudioContext (audio.js) with a stand-in context.
import { test } from "node:test";
import assert from "node:assert/strict";
import { load } from "./sandbox.mjs";

test("a suspended or interrupted context is resumed", () => {
  const resumed = [];
  class AudioContext {
    constructor() { this.state = "suspended"; }
    resume() { resumed.push(this.state); return Promise.resolve(); }
  }
  const { audioContext, resumeAudio } = load("audio.js", {
    AudioContext, window: { addEventListener() {} }, chrome: { runtime: { getURL: (path) => `chrome-extension://id/${path}` } },
  });
  const context = audioContext();
  resumeAudio();
  context.state = "interrupted";
  resumeAudio();
  context.state = "running";
  resumeAudio();
  assert.deepEqual(resumed, ["suspended", "interrupted"]);
});

test("in Firefox, a video routed while playing is seeked to where it is, once", () => {
  const node = () => ({ connect: (next) => next });
  class AudioContext {
    createMediaElementSource() { return node(); }
    createGain() { return node(); }
  }
  const cases = [
    ["moz-extension://id/", { paused: false }, [12.5]],
    ["chrome-extension://id/", { paused: false }, []],
    ["moz-extension://id/", { paused: true }, []],
    ["moz-extension://id/", { paused: false, seeking: true }, []],
  ];
  for (const [base, state, expected] of cases) {
    const seeks = [];
    const video = { paused: false, seeking: false, ...state, get currentTime() { return 12.5; }, set currentTime(time) { seeks.push(time); } };
    const { routeElement } = load("audio.js", {
      AudioContext, window: { addEventListener() {} }, chrome: { runtime: { getURL: (path) => base + path } },
    });
    routeElement(video);
    routeElement(video);
    assert.deepEqual(seeks, expected, `${base} ${JSON.stringify(state)}`);
  }
});
