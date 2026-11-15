// Kryptid Kei: tiny Spotify bridge (Netlify Function)
// Reads YOUR Spotify (now playing, recently played, public playlists) and hands the site a small JSON.
// Needs two environment variables in Netlify:  SPOTIFY_CLIENT_ID  and  SPOTIFY_REFRESH_TOKEN
// (the refresh token comes from /setup.html, one time). Nothing secret ever reaches the browser.

const TOKEN_URL = 'https://accounts.spotify.com/api/token';
const API = 'https://api.spotify.com/v1';

// kept while this function instance stays warm, so most calls skip the token refresh
const mem = { token: null, exp: 0, refresh: null, me: null, last: null };

async function accessToken() {
  const now = Date.now();
  if (mem.token && now < mem.exp - 30000) return mem.token;
  const body = new URLSearchParams({
    grant_type: 'refresh_token',
    refresh_token: mem.refresh || process.env.SPOTIFY_REFRESH_TOKEN,
    client_id: process.env.SPOTIFY_CLIENT_ID,
  });
  const res = await fetch(TOKEN_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body,
  });
  if (!res.ok) {
    const e = new Error('token refresh failed (' + res.status + ')');
    e.code = 'auth';
    throw e;
  }
  const j = await res.json();
  mem.token = j.access_token;
  mem.exp = now + (j.expires_in || 3600) * 1000;
  if (j.refresh_token) mem.refresh = j.refresh_token; // Spotify may hand out a new one; keep using the latest
  return mem.token;
}

async function sp(path, token) {
  const res = await fetch(API + path, { headers: { Authorization: 'Bearer ' + token } });
  if (res.status === 204) return null; // nothing playing right now
  if (!res.ok) {
    const e = new Error(path + ' -> ' + res.status);
    e.status = res.status;
    throw e;
  }
  return res.json();
}

// pick an image big enough for a small disc without downloading the huge one
function pickImg(images, minW) {
  if (!Array.isArray(images) || !images.length) return '';
  const sized = images.filter((i) => i && i.url).slice().sort((a, b) => (a.width || 9999) - (b.width || 9999));
  const hit = sized.find((i) => (i.width || 0) >= minW) || sized[sized.length - 1];
  return hit ? hit.url : '';
}

function mapTrack(t) {
  if (!t) return null;
  const isEp = t.type === 'episode';
  return {
    id: t.id || '',
    title: t.name || '',
    artist: isEp ? (t.show && t.show.name) || '' : (t.artists || []).map((a) => a.name).join(', '),
    album: isEp ? '' : (t.album && t.album.name) || '',
    image: pickImg(isEp ? t.images : t.album && t.album.images, 250),
    url: (t.external_urls && t.external_urls.spotify) || '',
  };
}

async function getMe(token) {
  if (mem.me) return mem.me;
  try {
    const me = await sp('/me', token);
    mem.me = me && me.id ? me.id : null;
  } catch (e) {
    mem.me = null;
  }
  return mem.me;
}

const json = (code, obj, cache) => ({
  statusCode: code,
  headers: {
    'Content-Type': 'application/json; charset=utf-8',
    'Cache-Control': cache ? 'public, max-age=15' : 'no-store',
    // Netlify's edge keeps a copy for 20s, so a busy page can't hammer Spotify
    'Netlify-CDN-Cache-Control': cache ? 'public, s-maxage=20, stale-while-revalidate=120' : 'no-store',
  },
  body: JSON.stringify(obj),
});

exports.handler = async () => {
  if (!process.env.SPOTIFY_CLIENT_ID || !process.env.SPOTIFY_REFRESH_TOKEN) {
    return json(500, { error: 'not_configured' });
  }
  try {
    const token = await accessToken();
    const [cur, rec, pls, meId] = await Promise.allSettled([
      sp('/me/player/currently-playing?additional_types=track,episode', token),
      sp('/me/player/recently-played?limit=50', token),
      sp('/me/playlists?limit=50', token),
      getMe(token),
    ]);

    // now playing (or paused on something)
    let now = null;
    if (cur.status === 'fulfilled' && cur.value && cur.value.item) {
      now = Object.assign(mapTrack(cur.value.item), { playing: !!cur.value.is_playing });
    }

    // recently played: newest first, same song only once, 8 of them
    const recent = [];
    const seen = new Set();
    if (rec.status === 'fulfilled' && rec.value && Array.isArray(rec.value.items)) {
      for (const it of rec.value.items) {
        const t = mapTrack(it.track);
        if (!t || !t.id || seen.has(t.id)) continue;
        seen.add(t.id);
        t.at = Date.parse(it.played_at) || 0;
        recent.push(t);
        if (recent.length >= 8) break;
      }
    }

    // playlists: only YOUR public ones (private ones never leave this function)
    const me = meId.status === 'fulfilled' ? meId.value : null;
    const playlists = [];
    if (pls.status === 'fulfilled' && pls.value && Array.isArray(pls.value.items)) {
      for (const p of pls.value.items) {
        if (!p || p.public !== true) continue;
        if (me && p.owner && p.owner.id !== me) continue;
        playlists.push({
          id: p.id,
          name: p.name || 'untitled',
          image: pickImg(p.images, 250),
          url: (p.external_urls && p.external_urls.spotify) || '',
          total: (p.items && p.items.total) != null ? p.items.total : (p.tracks && p.tracks.total) != null ? p.tracks.total : null,
        });
      }
    }

    // if everything failed (rate limit, hiccup) fall back to the last good answer
    const allFailed = [cur, rec, pls].every((r) => r.status === 'rejected');
    if (allFailed && mem.last) return json(200, Object.assign({}, mem.last, { stale: true }), false);
    if (allFailed) return json(502, { error: 'spotify_unreachable' });

    const out = { now, recent, playlists, updated: Date.now() };
    mem.last = out;
    return json(200, out, true);
  } catch (e) {
    if (e && e.code === 'auth') {
      mem.token = null;
      return json(401, { error: 'auth' }); // refresh token missing/expired -> redo /setup.html
    }
    if (mem.last) return json(200, Object.assign({}, mem.last, { stale: true }), false);
    return json(502, { error: 'spotify_unreachable' });
  }
};
