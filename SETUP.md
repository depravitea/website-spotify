# Music tab setup (about 10 minutes, one time)

What's in this folder:
- `public/index.html`  your whole site (with the new Music tab)
- `public/setup.html`  one-time page that grabs your Spotify token (delete it after)
- `netlify/functions/spotify.js`  the tiny helper that talks to Spotify so your keys stay secret
- `netlify.toml`  tells Netlify where everything is

IMPORTANT: Netlify drag-and-drop can't run functions. The folder has to go up through GitHub (or the Netlify CLI).

## 1. Make a Spotify app
1. Go to https://developer.spotify.com/dashboard and log in with the Premium account you want to show.
2. Create app. Name/description can be anything. Tick **Web API**.
3. Redirect URI: `https://YOUR-SITE.netlify.app/setup.html`  (your real site address + /setup.html, exactly, then Add + Save).
4. Open the app's Settings and copy the **Client ID**. (You do NOT need the secret.)

## 2. Put the site on GitHub, connect it to Netlify
1. New GitHub repo, upload everything in this folder (keep the folders as they are).
2. Netlify: Add new site, Import an existing project, GitHub, pick the repo, Deploy. It reads `netlify.toml` by itself.
   (If you have a custom domain on your old Netlify site, move it to the new site under Domain management.)
   Prefer the command line instead? `npx netlify-cli deploy --prod` inside this folder works too.
3. Make sure the redirect URI from step 1 matches the address you actually use.

## 3. Get your token
1. Open `https://YOUR-SITE/setup.html`.
2. Paste the Client ID, press connect, press Agree on Spotify.
3. Copy the token it shows you.

## 4. Give Netlify the two keys
Netlify, Site configuration, Environment variables, add:
- `SPOTIFY_CLIENT_ID` = your client ID
- `SPOTIFY_REFRESH_TOKEN` = the token from step 3

Then Deploys, Trigger deploy (so the function picks them up).

## 5. Clean up
Delete `public/setup.html` from the repo (it redeploys). The token is like a password to your listening data, so keep it only in Netlify.

## Notes
- The Music tab only asks Spotify when someone opens it, and refreshes about every 30 seconds while it's open.
- Only your PUBLIC playlists show. Private ones never leave the helper.
- Playing something in Spotify Private Session won't show up in "recently played".
- If the tab says "radio's down", check the two environment variables and redeploy. If the token ever stops working, just redo step 3 and 4.
- Your site's own background song is separate from the CD. The CD is just a visual of what you're listening to on Spotify.
