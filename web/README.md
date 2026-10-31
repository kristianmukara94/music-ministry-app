# APCCMMA Web Planner

A static site for planning Masses and Praise & Worship nights from a browser, hosted on Vercel. Plans, songs, users and linked
laptops come from the cloud API in `api/` (code in `server/`), backed by Neon Postgres. Every page asks the server who is signed
in, and the planner needs an account from your church's admin. The desktop app is not part of this folder.

## Sign-in

- Accounts are created by a church's first admin with `server/scripts/create-admin.mjs`, run in a terminal. Set
  `DATABASE_URL` in that terminal only, for example `set DATABASE_URL=...` in Command Prompt, and close the window afterwards.
  The script asks for the password at a hidden prompt, so it stays out of the shell history.
- Each new account must change its password the first time it signs in. Passwords are at least 10 characters.
- The API needs `DATABASE_URL` and `TOKEN_SECRET` (at least 32 characters) set in Vercel. Neither is in the repo.
- Local testing without Vercel: `node server/test/local-server.mjs`, then open http://localhost:8888. It uses a test database
  in memory and its own test accounts. It is not a substitute for `vercel dev` with the real Neon database.

## Pages

| Page | File |
| --- | --- |
| Plans | `index.html` |
| Sign in | `login.html` |
| Mass plan editor | `plan/mass.html` |
| Praise & Worship editor | `plan/praise.html` |
| Song list | `songs.html` |
| Devices & sync | `devices.html` |

`js/sample-data.js` holds only the fixed templates (the Mass steps, the Praise & Worship lineup, song categories and
languages). Everything else comes from the API.

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

## How the site and the API fit together

- `vercel.json` publishes `web/` as the site. There is no build step.
- `api/[name].js` is one Vercel function that serves every API route: `/api/<name>` runs `server/functions/<name>.js`. Only the
  names listed in `server/lib/vercel-adapter.js` are served; any other name gets 404.
- Desktop apps released before the move to Vercel call `/.netlify/functions/<name>`. `vercel.json` rewrites that path to
  `/api/<name>`, so those laptops keep syncing. Keep that rewrite until every church laptop has updated.
- `vercel.json` also sets the security headers (Content-Security-Policy, no framing, nosniff) and `no-store` on the API.
- `.vercelignore` keeps the desktop app, its resources, the tests and the admin scripts out of the upload.

## Deploy to Vercel

- **From Git:** when the Vercel project is connected to this repository, a push to `main` deploys. Leave the framework preset as
  Other; `vercel.json` sets the install command, the build command and the output folder.
- **From your computer:** install the Vercel CLI (`npm install -g vercel`), run `vercel login` and `vercel link`, then from the
  repo root run `vercel` for a preview and `vercel --prod` to publish.

## Before deploying

1. In Vercel (Project Settings, Environment Variables), set `DATABASE_URL` (the Neon connection string) and `TOKEN_SECRET`
   (at least 32 random characters) for Production and Preview. Neither is in the repo, and neither should be pasted into a
   file or a chat. Changing `TOKEN_SECRET` signs everyone out and unlinks every laptop, so set it once.
2. Set the function region (Project Settings, Functions) to the region nearest the Neon database, so each query does not cross
   an ocean.
3. Run the site locally against the Neon database with `vercel dev` (`vercel env pull` copies the variables for that session).
   Check: wrong password, unknown user and correct password behave as described under Sign-in; five wrong passwords lock the
   account; a viewer cannot open Users; the first admin can add, reset and unlock a user; and an admin can make a link code on
   Devices & sync that a laptop accepts.
4. Run the tests: `node --test server/test/*.test.mjs`.

## Rules for this site

- No lyrics and no Bible text. Songs are titles, categories, languages and keys; readings are references only.
- No scripts from other sites, apart from the Google Fonts stylesheet. No analytics.
