// Shared browser-test helpers: install the extension into a fresh browser
// profile, read Musicless's state, record what actually played, and analyze it.
import { cpSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { execFileSync } from "node:child_process";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import puppeteer from "puppeteer-core";
import { buildContent } from "../tools/build-content.mjs";
import { firefoxManifest, GECKO_ID } from "../tools/firefox-manifest.mjs";
import { instrumentExtension } from "./diagnostics/instrument.mjs";
import { chromePath } from "../tools/chrome.mjs";
export { chromePath };

// FIREFOX=<Firefox executable> runs the browser tests in Firefox (through
// WebDriver BiDi); otherwise they run in Chrome or another Chromium browser.
// Firefox takes the extension's language from its own, so tests in Arabic need
// an Arabic Firefox: FIREFOX_AR=<its executable>.
export const FIREFOX = process.env.FIREFOX || null;
// Firefox gives each install a random internal UUID; a fixed one gives the
// extension's pages a known address there.
const FIREFOX_UUID = "6d1c6f9e-1b2a-4c3d-9e8f-0a1b2c3d4e5f";

const TESTS = fileURLToPath(new URL(".", import.meta.url));
export const WORK = process.env.MUSICLESS_TEST_DIR ?? join(TESTS, ".work");
// MUSICLESS_EXTENSION tests another copy, e.g. an unzipped release package.
const EXTENSION = process.env.MUSICLESS_EXTENSION ?? fileURLToPath(new URL("../extension/", import.meta.url));
const ANALYZE = join(TESTS, "analyze.py");
export const PYTHON = process.env.MUSICLESS_PYTHON ?? join(TESTS, ".venv", "bin", "python");
const NS = "musicless";
mkdirSync(WORK, { recursive: true });

// The shipped manifest only matches YouTube; tests also allow the local server.
// The test copy also turns on Musicless's diagnostics (state and recordings, which
// the release cannot do): its manifest is marked, main.js answers requests for
// state and recordings, the recorder is bundled in, and the capture's state
// is readable from the page. `diagnostics: false` leaves them out, as in the release.
// Each launch gets its own copy, so parallel runs never see each other's edits.
function testExtension({ diagnostics = true } = {}) {
  const dir = mkdtempSync(join(WORK, "extension-under-test-"));
  cpSync(EXTENSION, dir, { recursive: true, dereference: true }); // worktrees may link the built model and runtime
  const manifest = JSON.parse(readFileSync(join(dir, "manifest.json"), "utf8"));
  if (diagnostics) {
    instrumentExtension(dir);
    manifest.musicless_test = true;
    buildContent(dir);
  }
  if (diagnostics) manifest.web_accessible_resources[0].resources.push("recorder-tap.js");
  for (const entry of [...manifest.content_scripts, ...manifest.web_accessible_resources]) {
    entry.matches.push("http://127.0.0.1/*");
  }
  const forBrowser = FIREFOX && !manifest.browser_specific_settings ? firefoxManifest(manifest) : manifest;
  writeFileSync(join(dir, "manifest.json"), JSON.stringify(forBrowser, null, 2));
  return dir;
}

// The address of one of the extension's own pages.
export const extensionUrl = (extensionId, path) => `${FIREFOX ? "moz-extension" : "chrome-extension"}://${extensionId}/${path}`;

// `autoplay: false` keeps the browser's real autoplay policy (sound needs a user gesture).
// The user has turned Musicless on (`consented`) unless a test says otherwise.
// `lang` is the browser's language, which picks Musicless's catalog.
export async function launch({ headless = true, autoStart = true, autoplay = true, consented = true, diagnostics = true, lang = "en-US" } = {}) {
  const profile = mkdtempSync(join(WORK, "profile-"));
  const browser = FIREFOX ? await launchFirefox({ headless, autoplay, lang, profile }) : await puppeteer.launch({
    executablePath: chromePath(),
    headless,
    pipe: true,
    enableExtensions: true,
    userDataDir: profile,
    args: [
      "--mute-audio", // the graph still runs; nothing comes out of the speakers
      `--autoplay-policy=${autoplay ? "no-user-gesture-required" : "document-user-activation-required"}`,
      "--no-first-run",
      "--disable-features=Translate,MediaEngagementBypassAutoplayPolicies",
      "--window-size=1280,900",
      `--lang=${lang}`,
      // Portable browser copies (and CI containers) cannot set up the sandbox.
      ...(process.env.MUSICLESS_NO_SANDBOX === "1" ? ["--no-sandbox"] : []),
    ],
    defaultViewport: { width: 1280, height: 900 },
  });
  const extension = testExtension({ diagnostics });
  const installed = await browser.installExtension(extension);
  const extensionId = FIREFOX ? FIREFOX_UUID : installed;
  // Remove the throwaway profile and extension copy once the browser has exited,
  // or when this script exits first (the browser is stopped then).
  const cleanup = () => {
    try { browser.process()?.kill("SIGKILL"); } catch { /* already gone */ }
    rmSync(profile, { recursive: true, force: true });
    rmSync(extension, { recursive: true, force: true });
  };
  browser.process()?.once("exit", cleanup);
  process.once("exit", cleanup);
  // The welcome page opens on install; tests do not need it. Close it once it
  // has loaded: in Edge, closing it mid-load can leave the extension's later
  // pages without their messages (they show the catalog keys).
  const welcome = await waitForExtensionPage(browser, extensionUrl(extensionId, "welcome.html"));
  await welcome.close();
  await setSettings(browser, extensionId, { autoStart, consented });
  return { browser, extensionId, extensionDir: extension };
}

// How far Musicless's sound may be from the video's own sound in the browser
// (lag_ms in analyze.py), and how much that may vary over a recording
// (lag_spread_ms). Firefox reports the video's position in steps of about
// 11 ms and its own sound reaches Web Audio up to 30 ms off it, so its
// readings wobble more: there, both limits are 45 ms, where sound ahead of
// the picture starts to be noticed (ITU-R BT.1359). Musicless's own timing,
// read against the video's position (media_env_lag_ms), keeps 30 ms everywhere.
export const LAG_LIMIT_MS = FIREFOX ? 45 : 30;
export const LAG_SPREAD_LIMIT_MS = FIREFOX ? 45 : 40;

async function launchFirefox({ headless, autoplay, lang, profile }) {
  const executablePath = lang.startsWith("ar") ? process.env.FIREFOX_AR : FIREFOX;
  if (!executablePath) throw new Error("Tests in Arabic need an Arabic Firefox: set FIREFOX_AR to its executable.");
  return puppeteer.launch({
    browser: "firefox",
    executablePath,
    headless,
    userDataDir: profile,
    // Lets WebDriver BiDi reach the extension's own pages.
    env: { ...process.env, MOZ_REMOTE_ALLOW_SYSTEM_ACCESS: "1" },
    extraPrefsFirefox: {
      // Sound may start without a gesture, or (`autoplay: false`) only after
      // the user has interacted with the page, as in Chrome.
      "media.autoplay.default": autoplay ? 0 : 1,
      "media.autoplay.blocking_policy": 0,
      "media.volume_scale": "0.0", // the graph still runs; nothing comes out of the speakers
      "extensions.webextensions.uuids": JSON.stringify({ [GECKO_ID]: FIREFOX_UUID }),
      "intl.accept_languages": lang,
      // Fullscreen from the test's script, which Chrome allows as a user
      // gesture (evaluateAsUser).
      "full-screen-api.allow-trusted-requests-only": false,
    },
    defaultViewport: { width: 1280, height: 900 },
  });
}

// The extension's page at `url` once it has loaded, opened by the extension
// (or the user), not by the test: Firefox reports such tabs as about:blank,
// so tabs are told apart by their own address. `except` skips older tabs.
export async function waitForExtensionPage(browser, url, { timeout = 20000, except = [] } = {}) {
  const started = Date.now();
  while (Date.now() - started < timeout) {
    for (const page of await browser.pages()) {
      if (except.includes(page)) continue;
      const loaded = await page.evaluate((url) => location.href.startsWith(url) && document.readyState === "complete", url).catch(() => false);
      if (loaded) return page;
    }
    await sleep(250);
  }
  throw new Error(`no tab opened ${url}`);
}

// Open one of the extension's pages in `page`. Firefox never reports these
// loads to WebDriver BiDi, so the page is watched until it has loaded.
// Opening the page it is already on reloads it.
export async function gotoExtensionPage(page, extensionId, path) {
  const url = extensionUrl(extensionId, path);
  if (!FIREFOX) {
    await page.goto(url);
    return;
  }
  await page.evaluate(() => { window.musiclessTestLeaving = true; }).catch(() => {});
  await page.goto(url, { timeout: 3000 }).catch(() => {});
  await until(page, (url) => location.href === url && document.readyState === "complete" && !window.musiclessTestLeaving, url,
    { timeout: 15000, label: `${path} to load` });
}

// Wait for `fn(arg)` to be truthy in the page. Puppeteer's waitForFunction
// builds functions from strings, which Firefox does not allow in the
// extension's own pages.
export async function until(page, fn, arg, { timeout = 30000, label = "condition" } = {}) {
  const started = Date.now();
  while (Date.now() - started < timeout) {
    if (await page.evaluate(fn, arg).catch(() => false)) return;
    await sleep(100);
  }
  throw new Error(`timed out waiting for ${label}`);
}

// Read something from the page without giving it user activation, which
// Puppeteer's evaluate does (the browser's autoplay policy would then allow
// sound). `expression` must give a JSON-serializable value. In Firefox this
// reaches into Puppeteer's internals, as does inFirefoxWindow: both follow the
// pinned puppeteer-core (package.json).
export async function readWithoutActivation(page, expression) {
  const json = `JSON.stringify(${expression})`;
  if (FIREFOX) {
    const result = await page.mainFrame().mainRealm().realm.evaluate(json, true, { userActivation: false, resultOwnership: "none" });
    if (result.type === "exception") throw new Error(result.exceptionDetails.text);
    return JSON.parse(result.result.value);
  }
  const cdp = await page.createCDPSession();
  try {
    const { result, exceptionDetails } = await cdp.send("Runtime.evaluate", { expression: json, userGesture: false, returnByValue: true });
    if (exceptionDetails) throw new Error(exceptionDetails.text);
    return JSON.parse(result.value);
  } finally {
    await cdp.detach();
  }
}

// Do something with user activation, as a click would give: Chrome needs
// it asked for; Puppeteer's evaluate in Firefox always gives it.
export async function evaluateAsUser(page, expression) {
  if (FIREFOX) return page.evaluate(expression);
  const cdp = await page.createCDPSession();
  try {
    await cdp.send("Runtime.evaluate", { expression, userGesture: true, awaitPromise: true });
  } finally {
    await cdp.detach();
  }
}

// Emulate CSS media features in `page`, e.g. { "prefers-color-scheme": "dark" };
// an empty value ends that one. Firefox has only its preferences for this,
// which apply to every page, so a test that emulates there resets them after.
const FIREFOX_MEDIA = {
  "prefers-color-scheme": ["layout.css.prefers-color-scheme.content-override", { dark: 0, light: 1 }],
  "prefers-reduced-motion": ["ui.prefersReducedMotion", { reduce: 1, "no-preference": 0 }],
  "forced-colors": ["browser.display.document_color_use", { active: 2, none: 0 }],
};
const forcedColors = new WeakMap(); // page -> its DevTools session emulating forced colors (Chrome)
export async function emulateMedia(page, features) {
  if (FIREFOX) {
    const prefs = Object.entries(features).map(([name, value]) => [FIREFOX_MEDIA[name][0], value ? FIREFOX_MEDIA[name][1][value] : null]);
    await setFirefoxPrefs(page, prefs);
    await sleep(100); // a changed preference reaches the page's style shortly after
    return;
  }
  const { "forced-colors": forced, ...rest } = features;
  if (Object.keys(rest).length) await page.emulateMediaFeatures(Object.entries(rest).map(([name, value]) => ({ name, value: value ?? "" })));
  // Puppeteer does not emulate forced colors; the DevTools protocol does,
  // for as long as its session stays open.
  if (forced !== undefined) {
    if (!forcedColors.has(page)) forcedColors.set(page, await page.createCDPSession());
    const cdp = forcedColors.get(page);
    await cdp.send("Emulation.setEmulatedMedia", { features: forced ? [{ name: "forced-colors", value: forced }] : [] });
    if (!forced) {
      forcedColors.delete(page);
      await cdp.detach();
    }
  }
}

// Run `expression` in Firefox's own window, which WebDriver BiDi may reach in
// a test browser (MOZ_REMOTE_ALLOW_SYSTEM_ACCESS); `page` is any of its pages.
async function inFirefoxWindow(page, expression) {
  const session = page.mainFrame().browsingContext.userContext.browser.session;
  const { result } = await session.send("browsingContext.getTree", { "moz:scope": "chrome" });
  const { result: done } = await session.send("script.evaluate", { expression, target: { context: result.contexts[0].context }, awaitPromise: false });
  if (done.type === "exception") throw new Error(`Firefox window: ${done.exceptionDetails.text}`);
}

// Set Firefox preferences ([name, integer or null to reset]) while it runs.
const setFirefoxPrefs = (page, prefs) => inFirefoxWindow(page, `${prefs.map(([name, value]) => value === null
  ? `Services.prefs.clearUserPref(${JSON.stringify(name)});` : `Services.prefs.setIntPref(${JSON.stringify(name)}, ${value});`).join("\n")}\n1`);

// Bring `page` to the front. WebDriver BiDi cannot for the extension's own
// pages in Firefox, so Firefox's window selects their tab instead.
export async function bringToFront(page) {
  if (!FIREFOX || !(await page.evaluate(() => location.protocol === "moz-extension:"))) return page.bringToFront();
  const url = await page.evaluate(() => location.href);
  await inFirefoxWindow(page, `gBrowser.selectedTab = gBrowser.tabs.find((tab) => tab.linkedBrowser.currentURI.spec === ${JSON.stringify(url)}); 1`);
}

// Whether `page` closes within `timeout` ms. Firefox does not always report an
// extension page closing itself, so a page that no longer answers counts too.
export async function closes(page, timeout = 8000) {
  let closed = false;
  page.once("close", () => { closed = true; });
  const started = Date.now();
  while (!closed && Date.now() - started < timeout) {
    if (await page.evaluate(() => false).catch(() => true)) return true;
    await sleep(200);
  }
  return closed;
}

// Remove the extension, as the user does from the browser's extension list.
export const uninstall = (browser, extensionId) => browser.uninstallExtension(FIREFOX ? GECKO_ID : extensionId);

// Change settings, as the popup and the welcome page do.
export async function setSettings(browser, extensionId, values) {
  const page = await browser.newPage();
  await gotoExtensionPage(page, extensionId, "popup.html");
  await page.evaluate((values) => chrome.storage.sync.set(values), values);
  const stored = await page.evaluate((keys) => chrome.storage.sync.get(keys), Object.keys(values));
  await page.close();
  return stored;
}

// Turn automatic removal on or off with the popup's switch, as the user does.
export async function setAutoStart(browser, extensionId, value) {
  const popup = await browser.newPage();
  await gotoExtensionPage(popup, extensionId, "popup.html");
  await popup.waitForSelector("#autoStart", { visible: true });
  if ((await popup.$eval("#autoStart", (box) => box.checked)) !== value) await popup.click("#autoStart");
  await until(popup, (value) => chrome.storage.sync.get("autoStart").then((stored) => stored.autoStart === value), value, { timeout: 5000, label: "the setting" });
  await popup.close();
  return value;
}

// Headless Chrome names itself in its user agent, and YouTube serves it
// differently; the page gets the agent Chrome has with a window. Firefox's
// agent is the same either way.
export async function useWindowedUserAgent(page) {
  const agent = await page.browser().userAgent();
  if (agent.includes("HeadlessChrome")) await page.setUserAgent(agent.replace("HeadlessChrome", "Chrome"));
}

export async function newPage(browser) {
  const page = await browser.newPage();
  page.logs = [];
  page.on("console", (message) => page.logs.push(`[${message.type()}] ${message.text()}`));
  page.on("pageerror", (error) => page.logs.push(`[pageerror] ${error.message}`));
  return page;
}

export const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

// Ask the page's Musicless content script (diagnostics are on in the test copy) for something.
export function debugRequest(frame, type, extra = {}) {
  return frame.evaluate(({ NS, type, extra }) => new Promise((resolve) => {
    const id = Math.random().toString(36).slice(2);
    const finish = (reply) => {
      clearTimeout(timer);
      window.removeEventListener("message", onMessage);
      resolve(reply);
    };
    const timer = setTimeout(() => finish(undefined), 3000);
    const onMessage = (event) => {
      if (event.data?.[NS] === "debug-reply" && event.data.id === id) {
        finish(event.data.reply);
      }
    };
    window.addEventListener("message", onMessage);
    window.postMessage({ [NS]: "debug", type, id, ...extra }, "*");
  }), { NS, type, extra });
}

// The session that matters (working, else on, else the first), plus its button.
export async function frameState(frame) {
  const state = await debugRequest(frame, "state");
  if (!state) return null;
  const button = await frame.evaluate(() => {
    const el = [...document.querySelectorAll(".musicless-btn")].find((b) => b.style.display !== "none");
    const panel = document.querySelector(".musicless-dialog:not([hidden])");
    return {
      label: el?.getAttribute("aria-label") ?? null,
      buttonState: el?.dataset.state ?? null,
      panel: panel ? panel.querySelector(".musicless-dialog__message")?.textContent : null,
    };
  });
  return { ...state, ...button };
}

export async function waitFor(frame, predicate, { timeout = 60000, label = "condition" } = {}) {
  const started = Date.now();
  let state = null;
  while (Date.now() - started < timeout) {
    state = await frameState(frame).catch(() => null);
    if (state && predicate(state)) return state;
    await sleep(250);
  }
  throw new Error(`timed out waiting for ${label}; last state ${JSON.stringify(state)?.slice(0, 600)}`);
}

// A real click on the visible Musicless button. A covering site dialog is a
// test failure: synthetic clicks cannot operate the trusted-only controls.
export async function clickButton(frame) {
  await frame.waitForSelector(".musicless-btn", { visible: true, timeout: 30000 });
  const button = await frame.evaluateHandle(() =>
    [...document.querySelectorAll(".musicless-btn")].find((b) => b.style.display !== "none"));
  const before = await button.evaluate((el) => el.dataset.musiclessStatus);
  await button.asElement().click();
  await sleep(800);
  const after = await button.evaluate((el) => el.dataset.musiclessStatus);
  if (after !== before) return null;
  const covered = await button.evaluate((el) => {
    const r = el.getBoundingClientRect();
    const top = document.elementFromPoint(r.left + r.width / 2, r.top + r.height / 2);
    return top === el || el.contains(top) ? null : `${top?.tagName?.toLowerCase()}.${[...(top?.classList ?? [])].join(".")}`;
  });
  if (covered) throw new Error(`Musicless button covered by ${covered}`);
}

// Choose an action in the recovery dialog by its data-action ("retry" or
// "original"), with a real click: the dialog ignores synthetic ones.
export async function chooseRecovery(frame, action) {
  const item = await frame.evaluateHandle((action) =>
    document.querySelector(`.musicless-dialog:not([hidden]) .musicless-dialog__action[data-action="${action}"]`), action);
  if (!item.asElement()) throw new Error(`no "${action}" action in the recovery dialog`);
  await item.asElement().click();
}

// Pull the recorder's last `seconds` of original and output audio from the page.
export const dump = (frame, seconds) => debugRequest(frame, "dump", { seconds });

// Sync, similarity and gap metrics for a recording (see analyze.py).
// With `source` (the page's media file), speed-independent checks against 1x Spleeter run too.
export function analyze(recording, name, { source } = {}) {
  if (!recording) throw new Error("no recording (is the session routed?)");
  const dir = join(WORK, "recordings");
  mkdirSync(dir, { recursive: true });
  const base = join(dir, name);
  writeFileSync(`${base}.original.s16`, Buffer.from(recording.original, "base64"));
  writeFileSync(`${base}.output.s16`, Buffer.from(recording.output, "base64"));
  writeFileSync(`${base}.media.json`, JSON.stringify(recording.media ?? []));
  const args = [ANALYZE, base, String(recording.rate), ...(source ? ["--source", source] : [])];
  const out = execFileSync(PYTHON, args, { encoding: "utf8", maxBuffer: 1 << 24 });
  return JSON.parse(out.trim().split("\n").pop());
}

// Resident memory of the browser's process tree, and of its extension processes:
// Chrome marks them on their command line, Firefox names its one "WebExtensions".
const isExtensionProcess = (proc) => FIREFOX ? processName(proc.pid) === "WebExtensions" : proc.args.includes("--extension-process");
function processName(pid) {
  try {
    return readFileSync(`/proc/${pid}/comm`, "utf8").trim();
  } catch {
    return null;
  }
}

export function memoryOfBrowser(browser) {
  const pid = browser.process()?.pid;
  if (!pid) return null;
  const tree = execFileSync("ps", ["-o", "pid=,ppid=,rss=,args=", "-A"], { encoding: "utf8" })
    .trim().split("\n").map((line) => {
      const [p, pp, rss, ...rest] = line.trim().split(/\s+/);
      return { pid: +p, ppid: +pp, rss: +rss, args: rest.join(" ") };
    });
  const ids = new Set([pid]);
  let grew = true;
  while (grew) {
    grew = false;
    for (const proc of tree) if (ids.has(proc.ppid) && !ids.has(proc.pid)) { ids.add(proc.pid); grew = true; }
  }
  const procs = tree.filter((proc) => ids.has(proc.pid));
  const mb = (list) => Math.round(list.reduce((sum, proc) => sum + proc.rss, 0) / 1024);
  return { total_mb: mb(procs), extension_mb: mb(procs.filter(isExtensionProcess)) };
}

export class Report {
  constructor(name) {
    this.name = name;
    this.rows = [];
  }
  record(scenario, ok, details) {
    const row = { scenario, ...details, ok: !!ok };
    this.rows.push(row);
    console.log(`${row.ok ? "PASS" : "FAIL"} ${scenario} ${JSON.stringify(details)}`);
  }
  // A scenario this browser cannot run (it lacks what the scenario needs).
  skip(scenario, reason) {
    this.rows.push({ scenario, ok: null, skipped: reason });
    console.log(`SKIP ${scenario} (${reason})`);
  }
  // "12/13 passed, 1 skipped", and whether any failed. A step that was retried
  // counts once, by its retry.
  summary() {
    const rows = this.rows.filter((row) => !row.retried);
    const count = (ok) => rows.filter((row) => row.ok === ok).length;
    const skipped = count(null);
    return { failed: count(false) > 0, text: `${count(true)}/${rows.length - skipped} passed${skipped ? `, ${skipped} skipped` : ""}` };
  }
  save() {
    mkdirSync(join(WORK, "results"), { recursive: true });
    writeFileSync(join(WORK, "results", `${this.name}.json`), JSON.stringify(this.rows, null, 1));
  }
}
