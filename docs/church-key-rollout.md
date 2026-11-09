# Church Key and Setup Key rollout

Setup keys and new church codes now end in a Modulo-31 check character. The desktop app refuses a setup key whose check character is wrong, before any request is sent.

Keys issued before this change have no check character, so about 30 in 31 of them will be refused by the updated desktop app. Those keys must be replaced before the desktop update goes out.

## How a release works here

One push to `main` starts two things at once:

| Started by the push | Result | Goes live |
| --- | --- | --- |
| Vercel Git integration | Server and web planner deploy | Automatically |
| `.github/workflows/auto-release.yml` | Desktop build, version bump, **draft** GitHub release | Only when you publish the draft by hand |

The hand-published draft is what keeps the desktop update behind the server and the key re-issue. **Do not publish it until step 3 is done.**

The version will be **v1.0.53**, because `v1.0.52` is already published without this work. CI picks the number from the latest tag.

## Which version pairs work

| | Old server | New server |
| --- | --- | --- |
| **Old desktop (v1.0.52 or earlier)** | Old and new keys work | Old and new keys work |
| **New desktop (v1.0.53)** | New keys only | New keys only |

The server accepts both kinds of key, and existing church codes stay valid. Only a new desktop app with an old key fails.

## Before you push

1. Decide on credential rotation (see the last section). If `TOKEN_SECRET` is changing, change it before step 3, because it invalidates every setup key made with the old value.
2. Bring local `main` up to date: `git pull --ff-only origin main`.
3. Run the checks. CI does not run the tests, so this is the only place they run:

   ```
   npm test
   node --test "server/test/*.test.mjs"
   node --test tools/setup-key-generator/setup-key-generator.test.mjs
   npm test --prefix tools/church-admin-key-generator
   npm run typecheck
   ```

   Expected: 1,570 desktop and shared tests, 310 server tests, 11 setup-key tool tests, 11 key generator app tests, all passing, and no TypeScript errors.

## Step 1: Push to `main`

Commit the change and push. This starts both the deploy and the desktop build.

## Step 2: Confirm the server is live

A failed Vercel deploy is silent: the site stays on the last good build. Check both of these:

1. The commit's Vercel status on GitHub is `success`.
2. The setup route loads the new code:

   ```
   curl -s -X POST https://music-ministry-app.vercel.app/api/setup-church-admin -H "Content-Type: application/json" -d "{}"
   ```

   Expected: HTTP 400 and `That setup key is not valid or has already been used.`
   A 500 or a function crash means the deploy is broken. Stop here and see Rollback.

## Step 3: Re-issue open setup keys

Run this from the updated working copy, because keys are made on your computer and not by the deployed server.

1. Set the credentials in the terminal only. Never put them in a file.

   ```powershell
   $env:DATABASE_URL = "..."
   $env:TOKEN_SECRET = "..."
   ```

2. Find the open keys, in the Neon SQL editor or the local tool's **Open keys** list:

   ```sql
   SELECT created_at, expires_at FROM setup_keys
   WHERE used_at IS NULL AND expires_at > now()
   ORDER BY created_at;
   ```

   Only hashes are stored, so this cannot show which parish holds which key. Match them using your own records. If there are no open keys, go to step 4.

3. Make one replacement for each key still needed, and send it to that parish. Each is shown once:

   ```
   node server/scripts/create-setup-key.mjs
   ```

   Or start the Church Admin Key Generator from this same terminal and click **Generate**. It saves each key in `setup_keys` before showing it, and it makes no key without both credentials. Rebuild it first with `npm run dist --prefix tools/church-admin-key-generator`, because a copy built before this change makes keys the server refuses. Every click creates a key that stays open for 7 days.

4. Retire the old keys, using the time just before the first replacement as the cutoff (UTC):

   ```sql
   UPDATE setup_keys SET expires_at = now()
   WHERE used_at IS NULL AND expires_at > now() AND created_at < '<cutoff>';
   ```

   Replacements also work on older desktop versions, so retiring the old keys locks nobody out.

## Step 4: Publish the desktop release

1. Confirm the `v1.0.53` Actions run succeeded and its draft has the `.exe`, the `.blockmap` and `latest.yml`.
2. Install the draft's build on a test laptop. Confirm a mistyped key shows the typing-mistake message at once, and a re-issued key is accepted.
3. Publish the draft. Installed apps are offered the update from then on.
4. Confirm `https://api.github.com/repos/kristianmukara94/music-ministry-app/releases/latest` reports `v1.0.53`.

## Rollback

- **Before the draft is published:** leave it unpublished or delete it. No desktop app is affected.
- **Server problem:** promote the previous deployment in Vercel. Keys and church codes made in the meantime keep working.
- **After the draft is published:** publish a new release that fixes the problem. Do not delete the published release, because installed apps read `latest.yml` from it.

## Credential rotation

| Credential | Effect of rotating |
| --- | --- |
| Neon database password | Update `DATABASE_URL` in Vercel and redeploy. Brief interruption only. |
| `TOKEN_SECRET` | Every web session ends, **every linked laptop must be linked again**, and open link codes and setup keys stop working. Plan it for a time between Masses. |

Set new values in the Vercel project settings and in your terminal session only. Keep them out of `tools/setup-key-generator/README.md` and every other file.
