# Musicless landing page

The static site for `musicless.ieasybooks.com` has English and Arabic pages.

## Local preview

Run these commands from the repository root with Node.js 22 or newer.

```sh
node landing/build.mjs
node landing/serve.mjs
```

Open `http://localhost:8840/`. It opens in Arabic when the browser's primary
language is Arabic and in English otherwise. Use `/en/` or `/ar/` to preview
a specific language. Set `PORT` to change the preview port.

## Editing the page

Edit the English and Arabic text, store links, and YouTube video IDs in
[content.mjs](content.mjs). Rebuild the site to see your changes.

The About, Privacy policy, Terms of use and Contact & support pages
(`/en/about`, `/en/privacy`, `/en/terms`, `/en/support` and the same under
`/ar/`) are built from [pages.txt](pages.txt), the approved text, one block per
page and language: line 1 is the title, line 2 the lead paragraph, `## ` starts
a section heading and every other line is a paragraph. Links are
`[label](href)`, and `tab:privacy` links to the privacy policy in the same
language. The **Last updated** line of the privacy policy and terms is in
[content.mjs](content.mjs). Change their text only to an approved version, and
update `tests/fixtures/landing-pages.txt` to match: the landing tests compare
every page with it word for word.

Each page shows a local poster. Selecting it loads that language's launch video
in YouTube's privacy-enhanced player. The link below opens the video on YouTube.

## Tests

After `./setup.sh --dev`:

```sh
npm run test:landing
```

The landing suite builds and serves the site on port 8841 (override with
`LANDING_TEST_PORT`) and launches Chrome (`CHROME` can override the executable).
Set `FIREFOX=/path/to/firefox` to run it in Firefox instead. It checks the
About, Privacy policy, Terms of use and Contact & support pages against the
approved text, with their links, footer, sitemap entries and layout.
Screenshots stay ignored under `tests/.work/landing`.

## Deployment

On Cloudflare Pages, use the repository root as the build root,
`node landing/build.mjs` as the build command, and `dist/landing` as the
output directory. On another static host, publish the contents of that
directory and serve `index.html` for `/`, `/en/`, and `/ar/`, and
`en/privacy.html` and the other pages at `/en/privacy` and so on, without a
redirect.
