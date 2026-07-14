// Generates deterministic placeholder media + the golden montage fixture.
// Run: npm run fixtures  (from renderer/)
import {mkdirSync, writeFileSync} from 'node:fs';
import {dirname, join} from 'node:path';
import {fileURLToPath} from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const assetsDir = join(root, 'public', 'assets');
const fixturesDir = join(root, 'fixtures');
mkdirSync(assetsDir, {recursive: true});
mkdirSync(fixturesDir, {recursive: true});

// ---- 12 gradient placeholder stills (1080x1920 SVG) ----
const palette = [
  ['#f5b971', '#8c3b4a'], ['#2b4b6f', '#0e1c2b'], ['#d98e73', '#5a2a3b'],
  ['#7fb7a3', '#2a4a44'], ['#e0c26e', '#7a4a2a'], ['#9a8ec7', '#3b2a5a'],
  ['#c76e6e', '#4a1f2b'], ['#6ea3c7', '#1f3b4a'], ['#c7b06e', '#4a3b1f'],
  ['#8cc76e', '#2b4a1f'], ['#c76ea3', '#4a1f3b'], ['#6ec7c0', '#1f4a47'],
];
const svg = (i, [c1, c2]) => `<svg xmlns="http://www.w3.org/2000/svg" width="1080" height="1920">
<defs><linearGradient id="g" x1="0" y1="0" x2="1" y2="1">
<stop offset="0" stop-color="${c1}"/><stop offset="1" stop-color="${c2}"/></linearGradient></defs>
<rect width="1080" height="1920" fill="url(#g)"/>
<circle cx="${280 + (i % 3) * 260}" cy="${640 + (i % 4) * 180}" r="150" fill="rgba(255,255,255,0.22)"/>
<text x="540" y="1010" font-size="230" font-family="Arial" font-weight="bold"
 fill="rgba(255,255,255,0.9)" text-anchor="middle">${String(i + 1).padStart(2, '0')}</text>
</svg>`;

const assets = {};
for (let i = 0; i < 12; i++) {
  const id = `IMG_${String(i + 1).padStart(3, '0')}`;
  writeFileSync(join(assetsDir, `${id}.svg`), svg(i, palette[i]));
  assets[id] = `assets/${id}.svg`;
}

// ---- click track: 120 BPM, 24 beats = 12s, downbeat accent every 4th ----
const sampleRate = 44100;
const bpm = 120;
const beats = 24;
const beatMs = 60000 / bpm;
const totalSamples = Math.ceil(((beats * beatMs) / 1000) * sampleRate);
const pcm = new Int16Array(totalSamples);
for (let b = 0; b < beats; b++) {
  const start = Math.floor(((b * beatMs) / 1000) * sampleRate);
  const freq = b % 4 === 0 ? 1320 : 880;
  const clickLen = Math.floor(0.04 * sampleRate);
  for (let n = 0; n < clickLen && start + n < totalSamples; n++) {
    const env = Math.exp(-n / (clickLen / 5));
    pcm[start + n] = Math.round(0.6 * 32767 * env * Math.sin((2 * Math.PI * freq * n) / sampleRate));
  }
}
const wav = Buffer.alloc(44 + pcm.length * 2);
wav.write('RIFF', 0); wav.writeUInt32LE(36 + pcm.length * 2, 4); wav.write('WAVE', 8);
wav.write('fmt ', 12); wav.writeUInt32LE(16, 16); wav.writeUInt16LE(1, 20); wav.writeUInt16LE(1, 22);
wav.writeUInt32LE(sampleRate, 24); wav.writeUInt32LE(sampleRate * 2, 28);
wav.writeUInt16LE(2, 32); wav.writeUInt16LE(16, 34);
wav.write('data', 36); wav.writeUInt32LE(pcm.length * 2, 40);
Buffer.from(pcm.buffer).copy(wav, 44);
writeFileSync(join(assetsDir, 'click_120bpm.wav'), wav);

// ---- golden montage EDL: 12 shots x 1000ms, cuts on beats ----
const shotMs = 1000;
const timeline = Array.from({length: 12}, (_, i) => {
  const zoomIn = i % 2 === 0;
  const entry = {
    asset: `IMG_${String(i + 1).padStart(3, '0')}`,
    kind: 'still',
    start_ms: i * shotMs,
    end_ms: (i + 1) * shotMs,
    motion: {
      type: 'ken_burns',
      from: {zoom: zoomIn ? 1.0 : 1.22, cx: 0.5, cy: 0.45},
      to: {zoom: zoomIn ? 1.18 : 1.02, cx: zoomIn ? 0.56 : 0.44, cy: 0.4},
      easing: 'easeOutCubic',
    },
    effects: [],
  };
  if (i === 0) {
    entry.text = {content: 'golden hour', style: 'caption_lower', in_ms: 100, out_ms: 900, anchor: 'lower_third'};
  }
  if (i === 6) {
    entry.text = {content: 'slow light', style: 'kinetic_word', in_ms: 0, out_ms: 1000, anchor: 'center'};
  }
  return entry;
});

const edl = {
  mode: 'montage',
  aspect: '9:16',
  fps: 30,
  duration_ms: 12000,
  audio: {
    track: 'assets/click_120bpm.wav',
    trim_start_ms: 0,
    beat_grid_ms: Array.from({length: beats}, (_, i) => i * beatMs),
    voiceover: null,
    mute_render: false,
  },
  timeline,
};

writeFileSync(join(fixturesDir, 'montage.json'), JSON.stringify({edl, assets}, null, 2));
console.log('fixtures written: 12 SVGs, click_120bpm.wav, fixtures/montage.json');
