// End-to-end tests of the built static site: the About, Privacy policy, Terms
// of use and Contact & support pages, served locally in a real browser.
import assert from 'node:assert/strict';
import { execFileSync, spawn } from 'node:child_process';
import { mkdirSync, readFileSync, readdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { join } from 'node:path';
import puppeteer from 'puppeteer-core';
import { chromePath } from '../tools/chrome.mjs';

const root = fileURLToPath(new URL('..', import.meta.url));
const work = join(root, 'tests/.work/landing');
mkdirSync(work, { recursive: true });
execFileSync(process.execPath, ['landing/build.mjs'], { cwd: root, stdio: 'inherit' });

const port = Number(process.env.LANDING_TEST_PORT || 8841);
const server = spawn(process.execPath, ['landing/serve.mjs'], { cwd: root, env: { ...process.env, PORT: String(port) }, stdio: ['ignore', 'pipe', 'inherit'] });
await new Promise((resolve, reject) => { server.stdout.once('data', resolve); server.once('error', reject); server.once('exit', code => reject(new Error(`Server exit ${code}`))); });
const firefox = process.env.FIREFOX;
const browser = await puppeteer.launch({
  ...(firefox ? { browser: 'firefox', executablePath: firefox } : { executablePath: chromePath() }), headless: true,
  args: ['--mute-audio', ...(process.env.MUSICLESS_NO_SANDBOX === '1' ? ['--no-sandbox'] : [])],
  defaultViewport: { width: 1280, height: 900 } });
const page = await browser.newPage();
const errors = [];
page.on('pageerror', error => errors.push(error.message));
page.on('console', message => { if (message.type() === 'error') console.log('Browser:', message.text()); });
console.log('Browser:', await browser.version());

// About, Privacy policy, Terms of use and Contact & support, in both languages.
// Their text must stay word for word the approved text in the fixture, whose
// blocks are "===== Musicless / <page> / <language>", with links as [label](href).
const site = join(root, 'dist/landing');
const origin = 'https://musicless.ieasybooks.com';
const textPages = ['about', 'privacy', 'terms', 'support'];
const dated = { privacy: true, terms: true };
const updated = { en: 'Last updated: November 20, 2026', ar: 'آخر تحديث: 20 نوفمبر 2026' };
const footerLinks = {
  en: [['About', '/en/about'], ['Privacy policy', '/en/privacy'], ['Terms of use', '/en/terms'],
    ['Contact & support', '/en/support'], ['Source code', 'https://github.com/ieasybooks/musicless']],
  ar: [['عن الإضافة', '/ar/about'], ['سياسة الخصوصية', '/ar/privacy'], ['شروط الاستخدام', '/ar/terms'],
    ['التواصل والدعم', '/ar/support'], ['الشيفرة المصدرية', 'https://github.com/ieasybooks/musicless']],
};
const approved = {};
for (const block of readFileSync(join(root, 'tests/fixtures/landing-pages.txt'), 'utf8').split(/^===== Musicless \/ /m).slice(1)) {
  const [header, ...lines] = block.trimEnd().split('\n');
  const [name, language] = header.split(' / ');
  approved[`${language}/${name}`] = lines.join('\n').replace(/\(tab:(\w+)\)/g, `(/${language}/$1)`);
}

async function checkTextPages() {
  const pagePaths = ['en', 'ar'].flatMap(language => textPages.map(name => `${language}/${name}`));
  assert.deepEqual(Object.keys(approved).sort(), [...pagePaths].sort(), 'The fixture has every page in both languages');
  // en/privacy.html answers at /en/privacy. A en/privacy/index.html would redirect to /en/privacy/.
  assert.deepEqual(readdirSync(site, { recursive: true }).filter(path => path.endsWith('.html')).sort(),
    ['index.html', 'en/index.html', 'ar/index.html', ...pagePaths.map(path => path + '.html')].sort());
  assert.deepEqual([...readFileSync(join(site, 'sitemap.xml'), 'utf8').matchAll(/<loc>([^<]+)<\/loc>/g)].map(match => match[1]).sort(),
    ['en/', 'ar/', ...pagePaths].map(path => `${origin}/${path}`).sort());

  const requests = [];
  const record = request => requests.push(request.url());
  page.on('request', record);
  for (const language of ['en', 'ar']) for (const name of textPages) for (const width of [390, 1280]) {
    const path = `${language}/${name}`;
    await page.setViewport({ width, height: 900 });
    const response = await page.goto(`http://127.0.0.1:${port}/${path}`, { waitUntil: 'networkidle0' });
    assert.equal(response.status(), 200, path);
    const facts = await page.evaluate(() => {
      const main = document.querySelector('main');
      const blocks = [...main.children];
      const text = element => [...element.childNodes].map(node => node.nodeName === 'A'
        ? `[${node.textContent}](${node.getAttribute('href')})`
        : node.nodeType === Node.TEXT_NODE ? node.textContent : `<${node.nodeName}>`).join('');
      return {
        lang: document.documentElement.lang, dir: document.documentElement.dir, title: document.title,
        description: document.querySelector('meta[name=description]').content,
        canonical: document.querySelector('link[rel=canonical]').href,
        alternates: [...document.querySelectorAll('link[rel=alternate]')].map(link => [link.hreflang, link.href]),
        tags: blocks.map(element => element.tagName + (element.className ? '.' + element.className : '')),
        text: blocks.filter(element => !element.matches('.updated'))
          .map(element => (element.tagName === 'H2' ? '## ' : '') + text(element)).join('\n'),
        updated: main.querySelector('.updated')?.textContent ?? null,
        visible: blocks.every(element => element.checkVisibility()),
        languages: [...document.querySelectorAll('.language-options a')].map(link => [link.getAttribute('href'), link.hasAttribute('aria-current')]),
        footer: [...document.querySelectorAll('footer nav a')].map(link => [link.textContent, link.getAttribute('href')]),
        current: [...document.querySelectorAll('footer nav a[aria-current=page]')].map(link => link.getAttribute('href')),
        headingFont: getComputedStyle(main.querySelector('h1')).fontFamily,
        fits: document.documentElement.scrollWidth <= innerWidth,
      };
    });
    const [title, lead] = approved[path].split('\n');
    assert.equal(facts.text, approved[path], path + ' must match the approved text');
    assert.equal(facts.lang, language);
    assert.equal(facts.dir, language === 'ar' ? 'rtl' : 'ltr');
    assert.ok(facts.title.startsWith(title), facts.title);
    assert.equal(facts.description, lead.replace(/\[([^\]]+)\]\([^)]+\)/g, '$1'));
    assert.equal(facts.canonical, `${origin}/${path}`);
    assert.deepEqual(facts.alternates, [['en', `${origin}/en/${name}`], ['ar', `${origin}/ar/${name}`]]);
    assert.deepEqual(facts.tags.slice(0, 2), ['H1', 'P.lead']);
    assert.ok(facts.tags.slice(dated[name] ? 3 : 2).every(tag => ['H2', 'P'].includes(tag)), facts.tags.join());
    assert.equal(facts.updated, dated[name] ? updated[language] : null, path + ' last updated');
    if (dated[name]) assert.equal(facts.tags[2], 'P.updated');
    assert.ok(facts.visible, path + ' shows all its text');
    assert.deepEqual(facts.languages, [[`/en/${name}`, language === 'en'], [`/ar/${name}`, language === 'ar']], path + ' language switcher');
    assert.deepEqual(facts.footer, footerLinks[language], path + ' footer');
    assert.deepEqual(facts.current, [`/${path}`]);
    if (language === 'ar') assert.match(facts.headingFont, /^Alexandria/);
    assert.ok(facts.fits, `${path} fits ${width}px without scrolling sideways`);
    await page.screenshot({ path: join(work, `${language}-${name}-${width}.png`), fullPage: true });
  }
  page.off('request', record);
  assert.deepEqual(requests.filter(url => !url.startsWith(`http://127.0.0.1:${port}/`)), [], 'The pages make no third-party requests');

  for (const path of ['', 'en/', 'ar/']) {
    await page.goto(`http://127.0.0.1:${port}/${path}`);
    const { lang, footer, eyebrow } = await page.evaluate(() => ({ lang: document.documentElement.lang,
      footer: [...document.querySelectorAll('footer nav a')].map(link => [link.textContent, link.getAttribute('href')]),
      eyebrow: document.querySelector('.eyebrow').textContent }));
    assert.deepEqual(footer, footerLinks[lang], `/${path} footer`);
    assert.equal(eyebrow, { en: 'Made by EasyBooks↗', ar: 'من الكتب المُيسّرة↗' }[lang]);
  }
  console.log('PASS About, Privacy policy, Terms of use and Contact & support: approved text, both languages, links, sitemap and layout');
}

try {
  await checkTextPages();
  assert.deepEqual(errors, []);
  console.log('PASS no uncaught page errors');
  console.log('All landing tests passed. Screenshots:', work);
} finally {
  await browser.close();
  server.kill();
}
