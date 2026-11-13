// A tab worker's connection to the shared model. Owns readiness, outstanding
// requests and liveness; audio scheduling only sees load/run and lifecycle callbacks.
// A MessagePort never reports that its remote worker has died.

const LOAD_TIMEOUT_MS = 60000;
const RUN_TIMEOUT_MS = 120000;
const MODEL_PING_MS = 5000;
const MODEL_SILENT_MS = 30000; // longer than the shared model ever runs one job

export function connectModel(modelPort, { onReady, onFailure }) {
  const pending = new Map();
  let nextId = 1;
  let started = false;
  let failure = null;
  let pinged = 0;
  let settle;
  const ready = new Promise((resolve, reject) => {
    settle = { resolve, reject };
  });
  const failed = (message) => {
    if (failure) return;
    failure = new Error(message);
    clearTimeout(loadTimer);
    clearInterval(watch);
    if (!started) settle.reject(failure);
    else onFailure(`The shared model stopped: ${message}`);
    for (const job of pending.values()) {
      clearTimeout(job.timer);
      job.reject(failure);
    }
    pending.clear();
  };
  const loadTimer = setTimeout(() => failed("it took too long"), LOAD_TIMEOUT_MS);
  ready.then((seconds) => {
    if (failure) return;
    clearTimeout(loadTimer);
    onReady(seconds);
  }, (error) => onFailure(`The model failed to load: ${error.message}`));
  // While results are due, ask now and then: a shared model that stays silent has stopped.
  const watch = setInterval(() => {
    if (!started || !pending.size) {
      pinged = 0;
    } else if (!pinged) {
      pinged = performance.now();
      modelPort.postMessage({ type: "ping" });
    } else if (performance.now() - pinged > MODEL_SILENT_MS) {
      failed("it stopped answering");
    }
  }, MODEL_PING_MS);
  modelPort.onmessage = ({ data }) => {
    if (failure) return; // a late answer cannot revive a failed connection
    pinged = 0;
    if (data.type === "ready") {
      started = true;
      settle.resolve(data.seconds);
    } else if (data.type === "failed") {
      failed(data.message);
    } else if (data.type === "result" || data.type === "error") {
      const job = pending.get(data.id);
      if (!job) return;
      pending.delete(data.id);
      clearTimeout(job.timer);
      if (data.type === "result") job.resolve({ mask: data.mask, ms: data.ms });
      else job.reject(new Error(data.message));
    }
  };
  modelPort.postMessage({ type: "load" });
  return {
    failed,
    load: () => failure ? Promise.reject(failure) : ready,
    async run(magnitude, priority) {
      await ready;
      if (failure) throw failure;
      return new Promise((resolve, reject) => {
        const id = nextId++;
        const timer = setTimeout(() => {
          pending.delete(id);
          reject(new Error("the shared model stopped answering"));
        }, RUN_TIMEOUT_MS);
        pending.set(id, { resolve, reject, timer });
        modelPort.postMessage({ type: "run", id, priority, magnitude }, [magnitude.buffer]);
      });
    },
  };
}
