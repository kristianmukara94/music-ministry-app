# APCCMMA Web Planner

A static site for planning Masses and Praise & Worship nights from a browser. Phase 1 runs on sample data only: nothing is
saved, and there is no sign-in yet. The desktop app is not part of this folder and is not affected by it.

## Pages

| Page | File |
| --- | --- |
| Plans | `index.html` |
| Sign in | `login.html` |
| Mass plan editor | `plan/mass.html` |
| Praise & Worship editor | `plan/praise.html` |
| Song list | `songs.html` |
| Devices & sync | `devices.html` |

All sample data is in `js/sample-data.js`. Phase 2 replaces that file with calls to the cloud sync API.

## Run it locally

The pages use JavaScript modules, which browsers do not load from `file://`. Serve the folder over HTTP instead, from the
repo root:

```sh
npx serve web
```

or, with Python:

```sh
python -m http.server 8000 --directory web
```

Then open the address it prints (for example http://localhost:3000 or http://localhost:8000).

## Deploy to Netlify

`netlify.toml` at the repo root already sets `publish = "web"`, and there is no build step.

- **From Git:** in Netlify, choose Add new site, then Import an existing project, and pick this repository. Netlify reads
  `netlify.toml`, so leave the build command empty.
- **From your computer:** install the Netlify CLI (`npm install -g netlify-cli`), run `netlify login`, then from the repo
  root run `netlify deploy` for a preview, and `netlify deploy --prod` to publish.

## Rules for this site

- No lyrics and no Bible text. Songs are titles, categories, languages and keys; readings are references only.
- No scripts from other sites, apart from the Google Fonts stylesheet. No analytics.
