// scripts/download_stems.js — run once from repo root: node scripts/download_stems.js
// Downloads verified CC0 / CC-BY ambient stems. Oscillator fallback covers any missing layer.
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
  {
    key: 'breath',
    filename: 'birds_wind_cc0.ogg',
    url: 'https://opengameart.org/sites/default/files/Birds%20and%20Wind%20-%20Ambient_1.ogg',
    license: 'CC0',
    attribution: '"Birds and Wind - Ambient" by Spring — opengameart.org — CC0',
  },
  {
    key: 'harmonic',
    filename: 'ether_vox_ccby.mp3',
    url: 'https://incompetech.com/music/royalty-free/mp3-royaltyfree/Ether%20Vox.mp3',
    license: 'CC-BY 3.0',
    attribution: '"Ether Vox" by Kevin MacLeod — incompetech.com — CC BY 3.0 — http://creativecommons.org/licenses/by/3.0/',
  },
  {
    key: 'spatial',
    filename: 'forest_ambience_cc0.mp3',
    url: 'https://opengameart.org/sites/default/files/Forest_Ambience.mp3',
    license: 'CC0',
    attribution: 'Forest Ambience — opengameart.org — CC0',
  },
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

const results = await Promise.allSettled(STEMS.map(downloadStem));
const failed  = results.filter(r => r.status === 'rejected' || r.value === false).length;
console.log(failed
  ? `\n${failed} layer(s) failed — chord engine + oscillator fallback will cover them.`
  : '\nAll stems ready. Run: npm run dev');
