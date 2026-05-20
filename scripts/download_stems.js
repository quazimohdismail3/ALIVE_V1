// scripts/download_stems.js — run once from repo root: node scripts/download_stems.js
// Downloads verified CC0 / CC-BY ambient stems. Oscillator fallback covers any missing layer.
//
// NOTE: incompetech.com resets TCP connections (ECONNRESET) after ~2 concurrent Node.js
// fetch() calls. If stems fail with "terminated", use the PowerShell fallback on Windows:
//   powershell -File scripts/download_stems.ps1
import { writeFileSync, mkdirSync, existsSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const PUBLIC_STEMS = join(__dirname, '../frontend/public/stems');

const STEMS = [
  {
    key: 'ground',
    filename: 'dungeon_drone_cc0.ogg',
    url: 'https://opengameart.org/sites/default/files/dungeon_ambient_1_0.ogg',
    license: 'CC0',
    attribution: 'Loopable Dungeon Ambience — opengameart.org/content/loopable-dungeon-ambience — CC0',
  },

  // ── breath pool (5 stems — rotation requires ≥2) ──────────────────────────
  {
    key: 'breath',
    filename: 'birds_wind_cc0.ogg',
    url: 'https://opengameart.org/sites/default/files/Birds%20and%20Wind%20-%20Ambient_1.ogg',
    license: 'CC0',
    attribution: '"Birds and Wind - Ambient" by Spring — opengameart.org — CC0',
  },
  {
    key: 'breath',
    filename: 'fresh_air_ccby.mp3',
    url: 'https://incompetech.com/music/royalty-free/mp3-royaltyfree/Fresh%20Air.mp3',
    license: 'CC-BY 3.0',
    attribution: '"Fresh Air" by Kevin MacLeod — incompetech.com — CC BY 3.0 — http://creativecommons.org/licenses/by/3.0/',
  },
  {
    key: 'breath',
    filename: 'soaring_ccby.mp3',
    url: 'https://incompetech.com/music/royalty-free/mp3-royaltyfree/Soaring.mp3',
    license: 'CC-BY 3.0',
    attribution: '"Soaring" by Kevin MacLeod — incompetech.com — CC BY 3.0 — http://creativecommons.org/licenses/by/3.0/',
  },
  {
    key: 'breath',
    filename: 'river_flute_ccby.mp3',
    url: 'https://incompetech.com/music/royalty-free/mp3-royaltyfree/River%20Flute.mp3',
    license: 'CC-BY 3.0',
    attribution: '"River Flute" by Kevin MacLeod — incompetech.com — CC BY 3.0 — http://creativecommons.org/licenses/by/3.0/',
  },
  {
    key: 'breath',
    filename: 'dreamer_ccby.mp3',
    url: 'https://incompetech.com/music/royalty-free/mp3-royaltyfree/Dreamer.mp3',
    license: 'CC-BY 3.0',
    attribution: '"Dreamer" by Kevin MacLeod — incompetech.com — CC BY 3.0 — http://creativecommons.org/licenses/by/3.0/',
  },

  // ── harmonic pool (5 stems — rotation requires ≥2) ───────────────────────
  {
    key: 'harmonic',
    filename: 'ether_vox_ccby.mp3',
    url: 'https://incompetech.com/music/royalty-free/mp3-royaltyfree/Ether%20Vox.mp3',
    license: 'CC-BY 3.0',
    attribution: '"Ether Vox" by Kevin MacLeod — incompetech.com — CC BY 3.0 — http://creativecommons.org/licenses/by/3.0/',
  },
  {
    key: 'harmonic',
    filename: 'infinite_perspective_ccby.mp3',
    url: 'https://incompetech.com/music/royalty-free/mp3-royaltyfree/Infinite%20Perspective.mp3',
    license: 'CC-BY 3.0',
    attribution: '"Infinite Perspective" by Kevin MacLeod — incompetech.com — CC BY 3.0 — http://creativecommons.org/licenses/by/3.0/',
  },
  {
    key: 'harmonic',
    filename: 'mesmerize_ccby.mp3',
    url: 'https://incompetech.com/music/royalty-free/mp3-royaltyfree/Mesmerize.mp3',
    license: 'CC-BY 3.0',
    attribution: '"Mesmerize" by Kevin MacLeod — incompetech.com — CC BY 3.0 — http://creativecommons.org/licenses/by/3.0/',
  },
  {
    key: 'harmonic',
    filename: 'drone_in_d_ccby.mp3',
    url: 'https://incompetech.com/music/royalty-free/mp3-royaltyfree/Drone%20in%20D.mp3',
    license: 'CC-BY 3.0',
    attribution: '"Drone in D" by Kevin MacLeod — incompetech.com — CC BY 3.0 — http://creativecommons.org/licenses/by/3.0/',
  },
  {
    key: 'harmonic',
    filename: 'dream_catcher_ccby.mp3',
    url: 'https://incompetech.com/music/royalty-free/mp3-royaltyfree/Dream%20Catcher.mp3',
    license: 'CC-BY 3.0',
    attribution: '"Dream Catcher" by Kevin MacLeod — incompetech.com — CC BY 3.0 — http://creativecommons.org/licenses/by/3.0/',
  },

  // ── spatial pool (5 stems — rotation requires ≥2) ────────────────────────
  {
    key: 'spatial',
    filename: 'forest_ambience_cc0.mp3',
    url: 'https://opengameart.org/sites/default/files/Forest_Ambience.mp3',
    license: 'CC0',
    attribution: 'Forest Ambience — opengameart.org — CC0',
  },
  {
    key: 'spatial',
    filename: 'magic_forest_ccby.mp3',
    url: 'https://incompetech.com/music/royalty-free/mp3-royaltyfree/Magic%20Forest.mp3',
    license: 'CC-BY 3.0',
    attribution: '"Magic Forest" by Kevin MacLeod — incompetech.com — CC BY 3.0 — http://creativecommons.org/licenses/by/3.0/',
  },
  {
    key: 'spatial',
    filename: 'garden_music_ccby.mp3',
    url: 'https://incompetech.com/music/royalty-free/mp3-royaltyfree/Garden%20Music.mp3',
    license: 'CC-BY 3.0',
    attribution: '"Garden Music" by Kevin MacLeod — incompetech.com — CC BY 3.0 — http://creativecommons.org/licenses/by/3.0/',
  },
  {
    key: 'spatial',
    filename: 'myst_on_moor_ccby.mp3',
    url: 'https://incompetech.com/music/royalty-free/mp3-royaltyfree/Myst%20on%20the%20Moor.mp3',
    license: 'CC-BY 3.0',
    attribution: '"Myst on the Moor" by Kevin MacLeod — incompetech.com — CC BY 3.0 — http://creativecommons.org/licenses/by/3.0/',
  },
  {
    key: 'spatial',
    filename: 'nightdreams_ccby.mp3',
    url: 'https://incompetech.com/music/royalty-free/mp3-royaltyfree/Nightdreams.mp3',
    license: 'CC-BY 3.0',
    attribution: '"Nightdreams" by Kevin MacLeod — incompetech.com — CC BY 3.0 — http://creativecommons.org/licenses/by/3.0/',
  },

  // ── morning pool (single-stem — not rotated) ─────────────────────────────
  {
    key: 'morning',
    filename: 'morning_ccby.mp3',
    url: 'https://incompetech.com/music/royalty-free/mp3-royaltyfree/Morning.mp3',
    license: 'CC-BY 3.0',
    attribution: '"Morning" by Kevin MacLeod — incompetech.com — CC BY 3.0 — http://creativecommons.org/licenses/by/3.0/',
  },
];

async function downloadStem(stem) {
  const dir  = join(PUBLIC_STEMS, stem.key);
  const dest = join(dir, stem.filename);
  mkdirSync(dir, { recursive: true });

  if (existsSync(dest)) {
    console.log(`SKIP  ${stem.key}/${stem.filename}`);
    return true;
  }

  console.log(`FETCH ${stem.key} ← ${stem.url}`);
  try {
    const res = await fetch(stem.url, {
      headers: { 'User-Agent': 'Mozilla/5.0 mission-alive/stem-downloader' },
      redirect: 'follow',
    });
    if (!res.ok) { console.error(`FAIL  ${stem.key}: HTTP ${res.status}`); return false; }

    const buf = await res.arrayBuffer();
    if (buf.byteLength < 50_000) {
      console.error(`FAIL  ${stem.key}: ${buf.byteLength}B — too small, likely not audio`);
      return false;
    }
    writeFileSync(dest, Buffer.from(buf));
    console.log(`OK    ${stem.key}/${stem.filename} (${(buf.byteLength / 1024).toFixed(0)} KB)`);
    return true;
  } catch (err) {
    console.error(`FAIL  ${stem.key}: ${err.message}`);
    return false;
  }
}

// Sequential download with 800ms gap — incompetech rate-limits parallel fetches.
let failed = 0;
for (const stem of STEMS) {
  const ok = await downloadStem(stem);
  if (!ok) failed++;
  await new Promise(r => setTimeout(r, 800));
}
console.log(failed
  ? `\n${failed} layer(s) failed — chord engine + oscillator fallback will cover them.`
  : '\nAll stems ready. Run: npm run dev');
