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

Each page shows a local poster. Selecting it loads that language's launch video
in YouTube's privacy-enhanced player. The link below opens the video on YouTube.

## Deployment

On Cloudflare Pages, use the repository root as the build root,
`node landing/build.mjs` as the build command, and `dist/landing` as the
output directory. On another static host, publish the contents of that
directory and serve `index.html` for `/`, `/en/`, and `/ar/`.
