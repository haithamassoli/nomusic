// Render Musicless's supplied brand artwork in ink and paper. The mark is a
// snapped eighth note with a gap in its stem. The 16 and 32 px toolbar icons
// each have their own drawing so the gap stays clear at those sizes.
// The logo is outlined artwork: no font is needed to render any brand image.
// YouTube's player glyphs stay separate and keep their original geometry.
//
// Usage (from the repository root): node tools/icons.mjs
// Needs the test tools (./setup.sh --dev) and a Chromium browser (CHROME, as
// for the tests).
import { copyFileSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import puppeteer from "../tests/node_modules/puppeteer-core/lib/esm/puppeteer/puppeteer-core.js";
import { chromePath } from "./chrome.mjs";
import { CUT, CUT_WIDTH, NOTE, STRIKE, STRIKE_WIDTH } from "../extension/player-glyph.js";

const ROOT = fileURLToPath(new URL("../", import.meta.url));
const BRAND = join(ROOT, "assets/brand");
const INK = "#1f1d1a";

// Set only the displayed size; the supplied paths and viewBox are unchanged.
function sized(name, width) {
  const source = readFileSync(join(BRAND, name), "utf8").trim();
  const [, , w, h] = source.match(/viewBox="([^"]+)"/)[1].split(" ").map(Number);
  return source.replace(/ width="[^"]*" height="[^"]*"/, ` width="${width}" height="${+(width * h / w).toFixed(2)}"`);
}

const PLAIN = NOTE.map(([tag, attributes]) =>
  `<${tag} ${Object.entries(attributes).map(([name, value]) => `${name}="${value}"`).join(" ")}/>`).join("");
const struck = `<mask id="cut1" maskUnits="userSpaceOnUse"><rect x="-4" y="-4" width="32" height="32" fill="#fff"/>` +
  `<path d="${CUT}" stroke="#000" stroke-width="${CUT_WIDTH}" stroke-linecap="round"/></mask>` +
  `<g mask="url(#cut1)" fill="#fff">${PLAIN}</g>` +
  `<path d="${STRIKE}" stroke="#fff" stroke-width="${STRIKE_WIDTH}" stroke-linecap="round"/>`;

async function render(page, html, width, height, file) {
  await page.setViewport({ width, height, deviceScaleFactor: 1 });
  await page.setContent(`<!doctype html><body style="margin:0;background:transparent">${html}</body>`, { waitUntil: "load" });
  await page.screenshot({ path: file, omitBackground: true, clip: { x: 0, y: 0, width, height } });
}

const profile = mkdtempSync(join(process.env.TMPDIR ?? tmpdir(), "musicless-icons-"));
const browser = await puppeteer.launch({
  executablePath: chromePath(), headless: true, pipe: true, userDataDir: profile,
  args: ["--no-first-run", "--mute-audio", "--disable-gpu", ...(process.env.MUSICLESS_NO_SANDBOX === "1" ? ["--no-sandbox"] : [])],
});
try {
  const page = await browser.newPage();
  for (const size of [16, 32, 48]) {
    const file = size < 48 ? `musicless-icon-${size}.svg` : "musicless-icon.svg";
    await render(page, sized(file, size), size, size, join(ROOT, `extension/icons/icon-${size}.png`));
  }
  // 96 px of art inside a 16 px transparent margin, as Chrome asks.
  const large = `<div style="padding:16px;line-height:0">${sized("musicless-icon.svg", 96)}</div>`;
  await render(page, large, 128, 128, join(ROOT, "extension/icons/icon-128.png"));
  copyFileSync(join(ROOT, "extension/icons/icon-128.png"), join(ROOT, "docs/store/store-icon-128.png"));
  const promo = `<div style="width:440px;height:280px;background:${INK};display:grid;place-items:center;line-height:0">${sized("musicless-logo-paper.svg", 320)}</div>`;
  await render(page, promo, 440, 280, join(ROOT, "docs/store/promo-tile-440x280.png"));
  copyFileSync(join(BRAND, "musicless-icon.svg"), join(ROOT, "extension/icons/icon.svg"));
  // The popup's logos: English, and Arabic with «بلا موسيقى».
  for (const tone of ["ink", "paper"]) {
    for (const name of [`musicless-logo-${tone}.svg`, `musicless-logo-ar-${tone}.svg`]) {
      copyFileSync(join(BRAND, name), join(ROOT, "extension/icons", name));
    }
  }
  // The player button's two glyphs, for sentences that point at it.
  writeFileSync(join(ROOT, "extension/icons/player-on.svg"), `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24">${struck}</svg>\n`);
  writeFileSync(join(ROOT, "extension/icons/player-off.svg"), `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24"><g fill="#fff">${PLAIN}</g></svg>\n`);
  console.log("wrote extension/icons/icon-{16,32,48,128}.png, extension/icons/{icon,player-on,player-off}.svg, extension/icons/musicless-logo{,-ar}-{ink,paper}.svg, docs/store/store-icon-128.png, docs/store/promo-tile-440x280.png");
} finally {
  await browser.close();
  rmSync(profile, { recursive: true, force: true });
}
