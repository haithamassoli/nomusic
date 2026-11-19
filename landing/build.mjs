import { cp, mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { resolve, join } from 'node:path';
import manifest from '../extension/manifest.json' with { type: 'json' };
import { firefoxManifest } from '../tools/firefox-manifest.mjs';
import { content, stores } from './content.mjs';

const here = fileURLToPath(new URL('.', import.meta.url));
const repo = resolve(here, '..');
const out = join(repo, 'dist/landing');
const origin = 'https://musicless.ieasybooks.com';
const firefoxMinimum = firefoxManifest(manifest).browser_specific_settings.gecko.strict_min_version;
const escape = s => s.replaceAll('&', '&amp;').replaceAll('"', '&quot;').replaceAll('<', '&lt;').replaceAll('>', '&gt;');
const arrow = '<svg class="arrow" viewBox="0 0 24 24" aria-hidden="true"><path d="M5 12h14m-6-6 6 6-6 6"/></svg>';
const play = '<svg class="play-icon" viewBox="0 0 24 24" aria-hidden="true"><path d="M8 5 20 12 8 19Z"/></svg>';
const globe = '<svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="12" cy="12" r="9"/><ellipse cx="12" cy="12" rx="4" ry="9"/><path d="M3 12h18"/></svg>';
// The root already contains the English page. Only Arabic needs another navigation.
const rootLanguageScript = `
  <script>
    if (location.pathname === '/') {
      const suffix = location.search + location.hash;
      if (navigator.language.toLowerCase().startsWith('ar')) {
        location.replace('/ar/' + suffix);
      } else {
        history.replaceState(history.state, '', '/en/' + suffix);
      }
    }
  </script>`;

await rm(out, { recursive: true, force: true });
await mkdir(join(out, 'assets'), { recursive: true });
for (const file of ['site.css', 'site.js']) await cp(join(here, file), join(out, 'assets', file));
for (const file of ['musicless-logo-ink.svg', 'musicless-logo-ar-ink.svg', 'musicless-icon.svg']) {
  await cp(join(repo, 'assets/brand', file), join(out, 'assets', file));
}
await cp(join(repo, 'extension/fonts/alexandria-arabic.woff2'), join(out, 'assets/alexandria-arabic.woff2'));
await cp(join(repo, 'extension/licenses/alexandria-OFL.txt'), join(out, 'assets/alexandria-OFL.txt'));
await cp(join(repo, 'extension/icons/player-on.svg'), join(out, 'assets/player-on.svg'));
await cp(join(repo, 'docs/store/github-social-1280x640.png'), join(out, 'assets/social.png'));
await cp(join(here, 'assets'), join(out, 'assets'), { recursive: true });

for (const [lang, c] of Object.entries(content)) {
  const videoUrl = `https://youtu.be/${c.videoId}`;
  const languages = Object.entries(content).map(([code, choice]) =>
    `<a href="/${code}/" hreflang="${code}" lang="${code}" dir="${choice.dir}"${code === lang ? ' aria-current="page"' : ''}>${choice.language}</a>`
  ).join('');
  const logo = lang === 'ar' ? 'musicless-logo-ar' : 'musicless-logo';
  const paperLogo = await readFile(join(repo, 'assets/brand', logo + '-paper.svg'), 'base64');
  const poster = `<svg xmlns="http://www.w3.org/2000/svg" width="1280" height="720" viewBox="0 0 1280 720">
  <rect width="1280" height="720" fill="#1f1d1a"/>
  <path d="M0 292h210m860 0h210M0 306h178m924 0h178M0 320h144m992 0h144" stroke="#4b453b" stroke-width="1"/>
  <image href="data:image/svg+xml;base64,${paperLogo}" x="345" y="230" width="590" height="125"/>
</svg>`;
  await writeFile(join(out, 'assets', `poster-${lang}.svg`), poster);
  const renderPage = (rootScript = '') => `<!doctype html>
<html lang="${lang}" dir="${c.dir}">
<head>
  <meta charset="utf-8">${rootScript}
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>${escape(c.title)}</title>
  <meta name="description" content="${escape(c.description)}">
  <meta name="theme-color" content="#f4ede0">
  <link rel="canonical" href="${origin}/${lang}/">
  <link rel="alternate" hreflang="en" href="${origin}/en/">
  <link rel="alternate" hreflang="ar" href="${origin}/ar/">
  <link rel="alternate" hreflang="x-default" href="${origin}/">
  <meta property="og:type" content="website">
  <meta property="og:title" content="${escape(c.title)}">
  <meta property="og:description" content="${escape(c.description)}">
  <meta property="og:url" content="${origin}/${lang}/">
  <meta property="og:locale" content="${lang === 'ar' ? 'ar_AR' : 'en_US'}">
  <meta property="og:image" content="${origin}/assets/social.png">
  <meta name="twitter:card" content="summary_large_image">
  <link rel="icon" type="image/svg+xml" href="/assets/musicless-icon.svg">
  ${lang === 'ar' ? '<link rel="preload" href="/assets/alexandria-arabic.woff2" as="font" type="font/woff2" crossorigin>' : ''}
  <link rel="stylesheet" href="/assets/site.css">
  <script src="/assets/site.js" defer></script>
</head>
<body>
  <a class="skip" href="#main">${c.skip}</a>
  <header class="header shell">
    <a class="logo" href="/${lang}/" aria-label="${c.home}"><img src="/assets/${logo}-ink.svg" width="170" height="36" alt="${c.name}"></a>
    <nav aria-label="${c.nav}">
      <a class="section-link" href="#how">${c.how}</a>
      <a class="section-link" href="#questions">${c.questions}</a>
      <details class="language">
        <summary aria-label="${c.chooseLanguage}" title="${c.chooseLanguage}">${globe}</summary>
        <div class="language-options">${languages}</div>
      </details>
    </nav>
  </header>
  <main id="main" class="main" tabindex="-1">
    <section class="hero" aria-labelledby="headline">
      <a class="eyebrow" href="https://ieasybooks.com/${lang}/">${c.initiative}<span aria-hidden="true">↗</span></a>
      <h1 id="headline">${c.headline}</h1>
      <p class="intro">${c.intro}</p>
      <div class="actions">
        <div class="stores">
          <a class="button" data-store="chrome" data-min-version="${manifest.minimum_chrome_version}" data-install-label="${c.install.replace('{browser}', 'Chrome')}" href="${stores.chrome}">
            <svg aria-hidden="true" viewBox="0 0 24 24"><use href="/assets/store-icons.svg#chrome"/></svg>
            <span>${c.chromeStore}</span>${arrow}
          </a>
          <a class="button" data-store="firefox" data-min-version="${firefoxMinimum}" data-install-label="${c.install.replace('{browser}', 'Firefox')}" href="${stores.firefox}">
            <svg aria-hidden="true" viewBox="0 0 24 24"><use href="/assets/store-icons.svg#firefox"/></svg>
            <span>${c.firefoxStore}</span>${arrow}
          </a>
        </div>
        <a class="watch-link" href="#film">${play}${c.watch}</a>
      </div>
      <p class="free">${c.free}</p>
    </section>

    <section id="film" class="film-section" aria-labelledby="film-title">
      <h2 id="film-title">${c.film}</h2>
      <div class="film">
        <a class="film-play" href="${videoUrl}" data-video-id="${c.videoId}">
          <img src="/assets/poster-${lang}.svg" alt="" width="1280" height="720">
          <span class="play-circle">${play}</span><span>${c.watch}</span>
        </a>
      </div>
      <a class="youtube-link" href="${videoUrl}">${c.youtube}</a>
    </section>

    <section id="how" class="how" aria-labelledby="how-title">
      <h2 id="how-title">${c.stepsTitle}</h2>
      <ol class="steps">${c.steps.map(([title, body], i) => `
        <li><span class="step-number" aria-hidden="true">${i + 1}</span><div><h3>${title}</h3><p>${body}</p></div></li>`).join('')}
      </ol>
      <div class="control-note"><span class="player-glyph" aria-hidden="true"><img src="/assets/player-on.svg" width="21" height="21" alt=""></span><p><strong>${c.control}</strong> ${c.controlBody}</p></div>
    </section>

    <section id="questions" class="questions" aria-labelledby="questions-title">
      <h2 id="questions-title">${c.faqTitle}</h2>
      <div class="faq-list">${c.faqs.map(([q, a]) => `
        <details><summary>${q}<span class="plus" aria-hidden="true"></span></summary><p>${a}</p></details>`).join('')}
      </div>
    </section>
  </main>
  <footer class="footer shell">
    <p>${c.footer} <a href="https://ieasybooks.com/${lang}/">${c.parent}</a>.</p>
    <nav aria-label="${c.footerNav}"><a href="https://github.com/ieasybooks/musicless">${c.source}</a><a href="https://github.com/ieasybooks/musicless/blob/main/docs/privacy.md${lang === 'ar' ? '#العربية' : ''}">${c.privacy}</a><a href="https://github.com/ieasybooks/musicless/issues">${c.help}</a></nav>
  </footer>
</body>
</html>
`;
  await mkdir(join(out, lang), { recursive: true });
  await writeFile(join(out, lang, 'index.html'), renderPage());
  if (lang === 'en') await writeFile(join(out, 'index.html'), renderPage(rootLanguageScript));
}
await writeFile(join(out, 'robots.txt'), `User-agent: *\nAllow: /\nSitemap: ${origin}/sitemap.xml\n`);
await writeFile(join(out, 'sitemap.xml'), `<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">${['en', 'ar'].map(lang => `<url><loc>${origin}/${lang}/</loc></url>`).join('')}</urlset>\n`);
console.log('Built dist/landing (static HTML, CSS and JavaScript; no runtime dependencies).');
