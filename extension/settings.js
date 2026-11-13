// User settings, mirrored from chrome.storage.sync (the popup and the first-run
// page write them): one mirror per extension context. Importing it does not
// touch Chrome; loadSettings starts observation before reading, so a change
// made during the read wins over the value read.
export const DEFAULTS = Object.freeze({
  // Remove music from every video as soon as it starts. When off, the user
  // clicks the Musicless button on a video to start.
  autoStart: true,
  // The user turned Musicless on after reading what it does (the first-run page
  // or the popup). Until then, and on each page until this is known there, it
  // keeps no audio: capture.js keeps only format headers.
  consented: false,
});

export const settings = { ...DEFAULTS };
const listeners = new Set();
let loading = null;

export function loadSettings() {
  loading ??= (async () => {
    let duringRead = {};
    try {
      chrome.storage.onChanged.addListener((changes, area) => {
        if (area !== "sync") return;
        let changed = false;
        for (const key of Object.keys(DEFAULTS)) {
          if (!(key in changes)) continue;
          const value = changes[key].newValue ?? DEFAULTS[key];
          settings[key] = value;
          if (duringRead) duringRead[key] = value;
          changed = true;
        }
        // Changes made during the first read reach listeners through its result.
        if (changed && !duringRead) for (const listener of listeners) listener(settings);
      });
      const stored = await chrome.storage.sync.get(DEFAULTS);
      for (const key of Object.keys(DEFAULTS)) settings[key] = stored[key] ?? DEFAULTS[key];
      Object.assign(settings, duringRead);
    } catch {
      // An updated/removed extension may lose storage access. Keep known values,
      // or the defaults (no consent) if nothing has been read.
    } finally {
      duringRead = null;
    }
    return settings;
  })();
  return loading;
}

export function onSettingsChanged(listener) {
  listeners.add(listener);
  return () => listeners.delete(listener);
}
