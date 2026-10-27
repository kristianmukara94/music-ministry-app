# APCCMMA Web Planner

A static site for planning Masses and Praise & Worship nights from a browser. Phase 1 runs on sample data only: nothing is
saved. Sign-in is real: every page asks the server who is signed in, and the planner needs an account from your church's admin.
The desktop app is not part of this folder and is not affected by it.

## Sign-in

- Accounts are created by a church's first admin with `netlify/functions/scripts/create-admin.mjs`, run in a terminal. Set
  `DATABASE_URL` in that terminal only, for example `set DATABASE_URL=...` in Command Prompt, and close the window afterwards.
  The script asks for the password at a hidden prompt, so it stays out of the shell history.
- Each new account must change its password the first time it signs in. Passwords are at least 10 characters.
- The sign-in functions need `DATABASE_URL` and `TOKEN_SECRET` (at least 32 characters) set in Netlify. Neither is in the repo.
- Local testing without Netlify: `node netlify/functions/test/local-server.mjs`, then open http://localhost:8888. It uses a
  test database in memory and its own test accounts. It is not a substitute for `netlify dev` with the real Neon database.

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

## Before deploying

1. In Netlify, set two environment variables for the site: `DATABASE_URL` (the Neon connection string) and `TOKEN_SECRET`
   (at least 32 random characters). Neither is in the repo, and neither should be pasted into a file or a chat.
2. Run the site locally against the Neon database with `netlify dev`. This needs the Netlify CLI and a link to the site
   (`netlify link`). Set `DATABASE_URL` and `TOKEN_SECRET` in your terminal only for that session, or use `netlify env`.
   Check: wrong password, unknown user and correct password behave as described under Sign-in; five wrong passwords lock
   the account; a viewer cannot open Users; and the first admin can add, reset and unlock a user.
3. Only then deploy. Do not change the site's visibility or the "Make public" setting to test. Leave them as they are.

## Rules for this site

- No lyrics and no Bible text. Songs are titles, categories, languages and keys; readings are references only.
- No scripts from other sites, apart from the Google Fonts stylesheet. No analytics.
