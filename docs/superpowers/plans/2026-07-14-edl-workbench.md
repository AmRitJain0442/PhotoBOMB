# EDL Workbench Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A local web app (`npm run workbench` in `renderer/`) to edit EDL JSON with live validation, preview with the real `Reel` via `@remotion/player`, upload photos, and trigger MP4 renders.

**Architecture:** Client and server both live inside the existing `renderer/` package (spec "Approach A") sharing its `node_modules`. Vite + React SPA in `renderer/workbench/` imports `Reel`/`EdlSchema`/`checkInvariants`/`msToFrame` directly from `renderer/src`; a small Express server (`renderer/server/workbench-server.mjs`, port 7787) lists/uploads assets and shells out to the proven `npx remotion render` CLI (single in-flight job). Vite (port 5799) proxies `/api` and `/renders` to the server and serves `renderer/public` as its publicDir so `staticFile()` URLs work in preview.

**Tech Stack:** Existing renderer stack (Remotion 4.0.489, zod 3, vitest) + `@remotion/player@4.0.489` (exact — must match remotion), `express`, `multer`, `vite`, `@vitejs/plugin-react`, `concurrently`.

## Global Constraints

- `@remotion/player` must be pinned to the exact installed remotion version (4.0.489; confirm with `npx remotion versions` before installing).
- Server port 7787; Vite dev port 5799; proxy `/api` and `/renders` → `http://localhost:7787`.
- Uploads accept images only: `.jpg .jpeg .png .webp .svg`; saved into `renderer/public/assets`; duplicate filename overwrites (deliberate, dev tool).
- One render at a time: second `POST /api/render` while running → HTTP 409.
- Asset ids are filenames without extension; asset map values are `assets/<file>` (staticFile-relative), matching `fixtures/montage.json`.
- All commands run from `renderer/` unless stated otherwise. Windows/PowerShell-safe.
- This is a dev tool: no auth, no deployment, no WebSockets (poll `GET /api/render/status`).

## File Structure

```
renderer/
  package.json                       # + deps, + "workbench"/"workbench:build" scripts
  tsconfig.json                      # include "workbench"
  server/workbench-server.mjs        # Express: assets list/upload, render job, mp4 serving
  workbench/
    vite.config.ts                   # root=workbench, publicDir=../public, proxy
    index.html
    src/
      main.tsx
      App.tsx                        # state: text, assets, validation, wiring
      styles.css
      lib/edl-text.ts                # edlFromText + assetsFromFiles (pure, tested)
      lib/edl-text.test.ts
      components/
        EdlEditor.tsx                # textarea + error list + Format/Load-fixture buttons
        PreviewPane.tsx              # <Player> wrapping Reel
        AssetStrip.tsx               # thumbnails + upload (browse + drop)
        RenderPanel.tsx              # render button, status poll, renders list
```

---

### Task 1: Dependencies, scripts, Vite scaffold

**Files:**
- Modify: `renderer/package.json` (deps via npm, scripts by edit)
- Modify: `renderer/tsconfig.json` (add "workbench" to include)
- Create: `renderer/workbench/vite.config.ts`, `renderer/workbench/index.html`, `renderer/workbench/src/main.tsx`, `renderer/workbench/src/App.tsx` (placeholder), `renderer/workbench/src/styles.css` (placeholder)

**Interfaces:**
- Produces: `npm run workbench` (server+vite concurrently), `npm run workbench:build` (compile check); Vite serving `renderer/public` at `/`, proxying `/api` + `/renders` to :7787.

- [ ] **Step 1: Install dependencies (exact player version)**

Run (in `renderer/`): `npx remotion versions` and confirm 4.0.489 (adjust the pin below if different). Then:

```bash
npm i @remotion/player@4.0.489 express multer
npm i -D vite @vitejs/plugin-react concurrently
```

- [ ] **Step 2: Add scripts to `renderer/package.json`**

Add to `"scripts"`:

```json
"workbench": "concurrently -k \"node server/workbench-server.mjs\" \"vite --config workbench/vite.config.ts --open\"",
"workbench:build": "vite build --config workbench/vite.config.ts"
```

- [ ] **Step 3: Add `"workbench"` to `renderer/tsconfig.json` include**

```json
"include": ["src", "fixtures", "workbench"]
```

- [ ] **Step 4: Create `renderer/workbench/vite.config.ts`**

```ts
import {defineConfig} from 'vite';
import react from '@vitejs/plugin-react';
import {dirname, join} from 'node:path';
import {fileURLToPath} from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));

export default defineConfig({
  root: here,
  publicDir: join(here, '..', 'public'),
  plugins: [react()],
  server: {
    port: 5799,
    proxy: {
      '/api': 'http://localhost:7787',
      '/renders': 'http://localhost:7787',
    },
  },
  build: {outDir: join(here, 'dist')},
});
```

- [ ] **Step 5: Create `renderer/workbench/index.html`**

```html
<!doctype html>
<html lang="en">
  <head>
    <meta charset="UTF-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1.0" />
    <title>Darkroom — EDL Workbench</title>
  </head>
  <body>
    <div id="root"></div>
    <script type="module" src="/src/main.tsx"></script>
  </body>
</html>
```

- [ ] **Step 6: Create `renderer/workbench/src/main.tsx`, placeholder `App.tsx`, empty `styles.css`**

`main.tsx`:

```tsx
import React from 'react';
import {createRoot} from 'react-dom/client';
import {App} from './App';
import './styles.css';

createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>,
);
```

`App.tsx` (placeholder, replaced in Task 4):

```tsx
import React from 'react';

export const App: React.FC = () => <div>EDL Workbench (scaffold)</div>;
```

`styles.css`: create empty file.

- [ ] **Step 7: Verify build + gitignore dist**

Run: `npm run workbench:build` — Expected: vite build completes, `workbench/dist/` created.
Append `workbench/dist/` to `renderer/.gitignore`.
Run: `npm run typecheck` — Expected: exits 0.
Run: `npm test` — Expected: all 29 existing tests pass.

- [ ] **Step 8: Commit**

```bash
git add renderer
git commit -m "feat(workbench): vite scaffold, deps, scripts"
```

---

### Task 2: `edl-text` pure helpers (TDD)

**Files:**
- Create: `renderer/workbench/src/lib/edl-text.ts`
- Test: `renderer/workbench/src/lib/edl-text.test.ts`

**Interfaces:**
- Consumes: `EdlSchema`, `checkInvariants`, `Edl` from `renderer/src/edl/`.
- Produces: `assetsFromFiles(files: string[]): Record<string, string>` (id → `assets/<file>`); `edlFromText(text: string, assetIds: Set<string>): {edl: Edl | null; errors: string[]}` — `edl` non-null only when fully valid.

- [ ] **Step 1: Write the failing test `workbench/src/lib/edl-text.test.ts`**

```ts
import {describe, expect, test} from 'vitest';
import fixture from '../../../fixtures/montage.json';
import {assetsFromFiles, edlFromText} from './edl-text';

const fixtureText = JSON.stringify(fixture.edl);
const fixtureIds = new Set(Object.keys(fixture.assets));

describe('assetsFromFiles', () => {
  test('maps filenames to ids and staticFile paths', () => {
    expect(assetsFromFiles(['IMG_001.svg', 'me.beach.jpg'])).toEqual({
      IMG_001: 'assets/IMG_001.svg',
      'me.beach': 'assets/me.beach.jpg',
    });
  });
});

describe('edlFromText', () => {
  test('valid EDL returns edl and no errors', () => {
    const r = edlFromText(fixtureText, fixtureIds);
    expect(r.errors).toEqual([]);
    expect(r.edl?.duration_ms).toBe(12000);
  });

  test('JSON syntax error reported, edl null', () => {
    const r = edlFromText('{not json', fixtureIds);
    expect(r.edl).toBeNull();
    expect(r.errors[0]).toMatch(/^JSON:/);
  });

  test('schema error reported with path', () => {
    const bad = JSON.parse(fixtureText);
    bad.timeline[0].kind = 'hologram';
    const r = edlFromText(JSON.stringify(bad), fixtureIds);
    expect(r.edl).toBeNull();
    expect(r.errors.join(' ')).toMatch(/timeline.0.kind/);
  });

  test('invariant error reported, edl null', () => {
    const bad = JSON.parse(fixtureText);
    bad.timeline[0].end_ms = 940;
    bad.timeline[1].start_ms = 940;
    const r = edlFromText(JSON.stringify(bad), fixtureIds);
    expect(r.edl).toBeNull();
    expect(r.errors.join(' ')).toMatch(/beat/i);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run workbench/src/lib/edl-text.test.ts`
Expected: FAIL — cannot resolve `./edl-text`.

- [ ] **Step 3: Implement `workbench/src/lib/edl-text.ts`**

```ts
import type {Edl} from '../../../src/edl/schema';
import {EdlSchema} from '../../../src/edl/schema';
import {checkInvariants} from '../../../src/edl/invariants';

export const assetsFromFiles = (files: string[]): Record<string, string> => {
  const map: Record<string, string> = {};
  for (const file of files) {
    map[file.replace(/\.[^.]+$/, '')] = `assets/${file}`;
  }
  return map;
};

// parse -> schema -> invariants; edl is non-null only when fully valid.
export const edlFromText = (
  text: string,
  assetIds: Set<string>,
): {edl: Edl | null; errors: string[]} => {
  let raw: unknown;
  try {
    raw = JSON.parse(text);
  } catch (e) {
    return {edl: null, errors: [`JSON: ${(e as Error).message}`]};
  }
  const parsed = EdlSchema.safeParse(raw);
  if (!parsed.success) {
    return {
      edl: null,
      errors: parsed.error.issues.map(
        (i) => `${i.path.join('.') || '(root)'}: ${i.message}`,
      ),
    };
  }
  const errors = checkInvariants(parsed.data, assetIds);
  return {edl: errors.length ? null : parsed.data, errors};
};
```

- [ ] **Step 4: Run tests to verify pass**

Run: `npx vitest run workbench/src/lib/edl-text.test.ts` — Expected: PASS (5 tests).
Run: `npm run typecheck` — Expected: exits 0.

- [ ] **Step 5: Commit**

```bash
git add renderer/workbench/src/lib
git commit -m "feat(workbench): edlFromText + assetsFromFiles helpers"
```

---

### Task 3: Workbench server

**Files:**
- Create: `renderer/server/workbench-server.mjs`

**Interfaces:**
- Consumes: `renderer/public/assets`, `renderer/out`, the `Reel` composition via `npx remotion render`.
- Produces (HTTP, port 7787): `GET /api/assets` → `[{id, file, url}]`; `POST /api/assets` (multipart field `files`) → `{saved: string[]}`; `POST /api/render` body `{edl, assets}` → 202 `{file}` or 409/400; `GET /api/render/status` → `{state: 'idle'|'running'|'done'|'failed', file, error, logTail}`; `GET /api/renders` → `[{file, url}]` newest-first; `GET /renders/:file` → MP4.

- [ ] **Step 1: Write `renderer/server/workbench-server.mjs`**

```js
import express from 'express';
import multer from 'multer';
import {spawn} from 'node:child_process';
import {existsSync, mkdirSync, readdirSync, statSync, writeFileSync} from 'node:fs';
import {basename, dirname, extname, join} from 'node:path';
import {fileURLToPath} from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const assetsDir = join(root, 'public', 'assets');
const outDir = join(root, 'out');
mkdirSync(assetsDir, {recursive: true});
mkdirSync(outDir, {recursive: true});

const IMAGE_EXT = new Set(['.jpg', '.jpeg', '.png', '.webp', '.svg']);
const MEDIA_EXT = new Set([...IMAGE_EXT, '.wav', '.mp3', '.m4a']);

const app = express();
app.use(express.json({limit: '5mb'}));

app.get('/api/assets', (_req, res) => {
  const files = readdirSync(assetsDir)
    .filter((f) => MEDIA_EXT.has(extname(f).toLowerCase()))
    .sort();
  res.json(
    files.map((file) => ({
      id: file.replace(/\.[^.]+$/, ''),
      file,
      url: `/assets/${file}`,
    })),
  );
});

const upload = multer({
  storage: multer.diskStorage({
    destination: assetsDir,
    filename: (_req, file, cb) =>
      cb(null, basename(file.originalname).replace(/[^\w.\-]/g, '_')),
  }),
  fileFilter: (_req, file, cb) =>
    cb(null, IMAGE_EXT.has(extname(file.originalname).toLowerCase())),
});

app.post('/api/assets', upload.array('files'), (req, res) => {
  const files = req.files ?? [];
  if (files.length === 0) {
    return res.status(400).json({error: 'no image files accepted (jpg/jpeg/png/webp/svg)'});
  }
  res.json({saved: files.map((f) => f.filename)});
});

// single in-flight render job
const job = {state: 'idle', file: null, error: null, log: ''};

app.post('/api/render', (req, res) => {
  if (job.state === 'running') {
    return res.status(409).json({error: 'a render is already running'});
  }
  const {edl, assets} = req.body ?? {};
  if (!edl || !assets) {
    return res.status(400).json({error: 'body must be {edl, assets}'});
  }
  const ts = new Date().toISOString().replace(/[:.]/g, '-');
  const outName = `workbench-${ts}.mp4`;
  const propsPath = join(outDir, `workbench-${ts}.json`);
  writeFileSync(propsPath, JSON.stringify({edl, assets}));
  Object.assign(job, {state: 'running', file: outName, error: null, log: ''});
  const child = spawn(
    'npx',
    ['remotion', 'render', 'Reel', `out/${outName}`, `--props=${propsPath}`, '--log=error'],
    {cwd: root, shell: true},
  );
  const append = (d) => {
    job.log = (job.log + d.toString()).slice(-4000);
  };
  child.stdout.on('data', append);
  child.stderr.on('data', append);
  child.on('close', (code) => {
    const ok = code === 0 && existsSync(join(outDir, outName));
    job.state = ok ? 'done' : 'failed';
    if (!ok) {
      job.error = job.log.split('\n').filter(Boolean).slice(-15).join('\n');
    }
  });
  res.status(202).json({file: outName});
});

app.get('/api/render/status', (_req, res) => {
  res.json({state: job.state, file: job.file, error: job.error, logTail: job.log.slice(-1500)});
});

app.get('/api/renders', (_req, res) => {
  const files = readdirSync(outDir)
    .filter((f) => f.endsWith('.mp4'))
    .map((f) => ({file: f, mtime: statSync(join(outDir, f)).mtimeMs}))
    .sort((a, b) => b.mtime - a.mtime);
  res.json(files.map(({file}) => ({file, url: `/renders/${file}`})));
});

app.get('/renders/:file', (req, res) => {
  const f = basename(req.params.file);
  const p = join(outDir, f);
  if (!f.endsWith('.mp4') || !existsSync(p)) return res.status(404).end();
  res.sendFile(p);
});

app.listen(7787, () => {
  console.log('workbench server on http://localhost:7787');
});
```

- [ ] **Step 2: Smoke-test endpoints**

Start in background: `node server/workbench-server.mjs`
Then verify:
- `curl http://localhost:7787/api/assets` → JSON array including `{"id":"IMG_001",...}` entries (13 files: 12 SVGs + click WAV).
- `curl http://localhost:7787/api/render/status` → `{"state":"idle",...}`.
- `curl http://localhost:7787/api/renders` → array (contains `reel.mp4` from M0 if still present).
Stop the server.

- [ ] **Step 3: Commit**

```bash
git add renderer/server
git commit -m "feat(workbench): express server for assets, uploads, renders"
```

---

### Task 4: Workbench UI

**Files:**
- Modify: `renderer/workbench/src/App.tsx` (replace placeholder)
- Create: `renderer/workbench/src/components/EdlEditor.tsx`, `PreviewPane.tsx`, `AssetStrip.tsx`, `RenderPanel.tsx`
- Modify: `renderer/workbench/src/styles.css`

**Interfaces:**
- Consumes: `edlFromText`, `assetsFromFiles` (Task 2); server API (Task 3); `Reel`, `ReelProps` from `renderer/src/Reel`; `msToFrame` from `renderer/src/edl/time`; `Edl` from `renderer/src/edl/schema`; fixture at `renderer/fixtures/montage.json`.
- Produces: working SPA at `http://localhost:5799`.

- [ ] **Step 1: Write `App.tsx`**

```tsx
import React, {useCallback, useEffect, useMemo, useState} from 'react';
import fixture from '../../fixtures/montage.json';
import {assetsFromFiles, edlFromText} from './lib/edl-text';
import type {Edl} from '../../src/edl/schema';
import {EdlEditor} from './components/EdlEditor';
import {PreviewPane} from './components/PreviewPane';
import {AssetStrip} from './components/AssetStrip';
import {RenderPanel} from './components/RenderPanel';

export type AssetInfo = {id: string; file: string; url: string};

export const App: React.FC = () => {
  const [text, setText] = useState(() => JSON.stringify(fixture.edl, null, 2));
  const [assetFiles, setAssetFiles] = useState<AssetInfo[]>([]);

  const refreshAssets = useCallback(async () => {
    const r = await fetch('/api/assets');
    setAssetFiles(await r.json());
  }, []);
  useEffect(() => {
    refreshAssets();
  }, [refreshAssets]);

  const assets = useMemo(
    () => assetsFromFiles(assetFiles.map((a) => a.file)),
    [assetFiles],
  );
  const {edl, errors} = useMemo(
    () => edlFromText(text, new Set(Object.keys(assets))),
    [text, assets],
  );

  const [lastValid, setLastValid] = useState<Edl | null>(null);
  useEffect(() => {
    if (edl) setLastValid(edl);
  }, [edl]);

  return (
    <div className="app">
      <header>
        <h1>darkroom — edl workbench</h1>
        <span className={edl ? 'chip ok' : 'chip bad'}>
          {edl ? 'valid' : `${errors.length} error${errors.length === 1 ? '' : 's'}`}
        </span>
      </header>
      <main>
        <section className="left">
          <EdlEditor
            text={text}
            errors={errors}
            onChange={setText}
            onLoadFixture={() => setText(JSON.stringify(fixture.edl, null, 2))}
          />
        </section>
        <section className="right">
          <PreviewPane edl={lastValid} assets={assets} stale={!edl} />
          <AssetStrip assets={assetFiles} onUploaded={refreshAssets} />
          <RenderPanel edl={edl} assets={assets} />
        </section>
      </main>
    </div>
  );
};
```

- [ ] **Step 2: Write `components/EdlEditor.tsx`**

```tsx
import React from 'react';

export const EdlEditor: React.FC<{
  text: string;
  errors: string[];
  onChange: (t: string) => void;
  onLoadFixture: () => void;
}> = ({text, errors, onChange, onLoadFixture}) => {
  const format = () => {
    try {
      onChange(JSON.stringify(JSON.parse(text), null, 2));
    } catch {
      // leave text as-is; error already shown
    }
  };
  return (
    <div className="editor">
      <div className="toolbar">
        <button onClick={format}>format json</button>
        <button onClick={onLoadFixture}>load fixture</button>
      </div>
      <textarea
        spellCheck={false}
        value={text}
        onChange={(e) => onChange(e.target.value)}
      />
      {errors.length > 0 && (
        <ul className="errors">
          {errors.map((e, i) => (
            <li key={i}>{e}</li>
          ))}
        </ul>
      )}
    </div>
  );
};
```

- [ ] **Step 3: Write `components/PreviewPane.tsx`**

```tsx
import React from 'react';
import {Player} from '@remotion/player';
import type {Edl} from '../../../src/edl/schema';
import {msToFrame} from '../../../src/edl/time';
import {Reel} from '../../../src/Reel';

export const PreviewPane: React.FC<{
  edl: Edl | null;
  assets: Record<string, string>;
  stale: boolean;
}> = ({edl, assets, stale}) => {
  if (!edl) {
    return <div className="preview empty">no valid edl yet</div>;
  }
  return (
    <div className={stale ? 'preview stale' : 'preview'} title={stale ? 'showing last valid EDL' : ''}>
      <Player
        component={Reel}
        inputProps={{edl, assets}}
        durationInFrames={msToFrame(edl.duration_ms, edl.fps)}
        fps={edl.fps}
        compositionWidth={1080}
        compositionHeight={1920}
        controls
        loop
        style={{width: 297, height: 528}}
      />
      {stale && <div className="stale-note">edl has errors — showing last valid</div>}
    </div>
  );
};
```

- [ ] **Step 4: Write `components/AssetStrip.tsx`**

```tsx
import React, {useRef, useState} from 'react';
import type {AssetInfo} from '../App';

const IMAGE_RE = /\.(jpe?g|png|webp|svg)$/i;

export const AssetStrip: React.FC<{
  assets: AssetInfo[];
  onUploaded: () => void;
}> = ({assets, onUploaded}) => {
  const input = useRef<HTMLInputElement>(null);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState('');

  const send = async (files: FileList | File[]) => {
    const fd = new FormData();
    for (const f of files) fd.append('files', f);
    setBusy(true);
    try {
      const r = await fetch('/api/assets', {method: 'POST', body: fd});
      const body = await r.json();
      setMessage(r.ok ? `added: ${body.saved.join(', ')}` : body.error);
      if (r.ok) onUploaded();
    } finally {
      setBusy(false);
    }
  };

  return (
    <div
      className="assets"
      onDragOver={(e) => e.preventDefault()}
      onDrop={(e) => {
        e.preventDefault();
        send(e.dataTransfer.files);
      }}
    >
      <div className="toolbar">
        <span>assets ({assets.length})</span>
        <button disabled={busy} onClick={() => input.current?.click()}>
          {busy ? 'uploading…' : 'add photos'}
        </button>
        <input
          ref={input}
          type="file"
          accept=".jpg,.jpeg,.png,.webp,.svg"
          multiple
          hidden
          onChange={(e) => e.target.files && send(e.target.files)}
        />
      </div>
      <div className="thumbs">
        {assets.map((a) =>
          IMAGE_RE.test(a.file) ? (
            <figure key={a.file}>
              <img src={a.url} alt={a.id} />
              <figcaption>{a.id}</figcaption>
            </figure>
          ) : (
            <figure key={a.file} className="audio">
              <span>♪</span>
              <figcaption>{a.id}</figcaption>
            </figure>
          ),
        )}
      </div>
      {message && <div className="note">{message}</div>}
    </div>
  );
};
```

- [ ] **Step 5: Write `components/RenderPanel.tsx`**

```tsx
import React, {useCallback, useEffect, useRef, useState} from 'react';
import type {Edl} from '../../../src/edl/schema';

type Status = {state: 'idle' | 'running' | 'done' | 'failed'; file: string | null; error: string | null; logTail: string};
type RenderFile = {file: string; url: string};

export const RenderPanel: React.FC<{
  edl: Edl | null;
  assets: Record<string, string>;
}> = ({edl, assets}) => {
  const [status, setStatus] = useState<Status>({state: 'idle', file: null, error: null, logTail: ''});
  const [renders, setRenders] = useState<RenderFile[]>([]);
  const timer = useRef<number>();

  const refreshRenders = useCallback(async () => {
    setRenders(await (await fetch('/api/renders')).json());
  }, []);
  useEffect(() => {
    refreshRenders();
  }, [refreshRenders]);

  const poll = useCallback(async () => {
    const s: Status = await (await fetch('/api/render/status')).json();
    setStatus(s);
    if (s.state === 'running') {
      timer.current = window.setTimeout(poll, 2000);
    } else if (s.state === 'done' || s.state === 'failed') {
      refreshRenders();
    }
  }, [refreshRenders]);
  useEffect(() => () => window.clearTimeout(timer.current), []);

  const start = async () => {
    if (!edl) return;
    const r = await fetch('/api/render', {
      method: 'POST',
      headers: {'Content-Type': 'application/json'},
      body: JSON.stringify({edl, assets}),
    });
    if (r.status === 202) {
      setStatus({state: 'running', file: null, error: null, logTail: ''});
      timer.current = window.setTimeout(poll, 2000);
    } else {
      const body = await r.json();
      setStatus({state: 'failed', file: null, error: body.error, logTail: ''});
    }
  };

  return (
    <div className="render">
      <div className="toolbar">
        <button disabled={!edl || status.state === 'running'} onClick={start}>
          {status.state === 'running' ? 'rendering…' : 'render mp4'}
        </button>
        <span className={`chip ${status.state}`}>{status.state}</span>
      </div>
      {status.state === 'failed' && status.error && <pre className="errors">{status.error}</pre>}
      {renders.length > 0 && (
        <ul className="renders">
          {renders.slice(0, 5).map((r) => (
            <li key={r.file}>
              <a href={r.url} target="_blank" rel="noreferrer">
                {r.file}
              </a>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
};
```

- [ ] **Step 6: Write `styles.css`**

```css
* { box-sizing: border-box; }
body {
  margin: 0;
  background: #111214;
  color: #e8e6e1;
  font: 14px/1.5 system-ui, sans-serif;
}
.app { display: flex; flex-direction: column; height: 100vh; }
header {
  display: flex; align-items: center; gap: 12px;
  padding: 10px 16px; border-bottom: 1px solid #26282c;
}
header h1 { font-size: 15px; font-weight: 600; letter-spacing: 0.08em; margin: 0; }
main { flex: 1; display: grid; grid-template-columns: 1fr 360px; min-height: 0; }
.left { display: flex; min-height: 0; border-right: 1px solid #26282c; }
.editor { display: flex; flex-direction: column; flex: 1; min-height: 0; }
.editor textarea {
  flex: 1; resize: none; border: 0; outline: none; padding: 12px 16px;
  background: #111214; color: #e8e6e1;
  font: 13px/1.5 Consolas, 'Courier New', monospace;
}
.toolbar { display: flex; align-items: center; gap: 8px; padding: 8px 12px; border-bottom: 1px solid #26282c; }
button {
  background: #2a2d33; color: #e8e6e1; border: 1px solid #3a3e46;
  border-radius: 6px; padding: 5px 12px; cursor: pointer; font: inherit;
}
button:disabled { opacity: 0.45; cursor: default; }
button:hover:not(:disabled) { background: #34383f; }
.errors {
  margin: 0; padding: 10px 16px 10px 32px; max-height: 30vh; overflow: auto;
  background: #1d1416; color: #f0a3a3; border-top: 1px solid #4a2226;
  font: 12px/1.6 Consolas, monospace; white-space: pre-wrap;
}
.right { display: flex; flex-direction: column; overflow-y: auto; }
.preview { padding: 12px; display: flex; flex-direction: column; align-items: center; gap: 6px; }
.preview.empty { color: #7a7d84; padding: 40px; text-align: center; }
.preview.stale { opacity: 0.55; }
.stale-note { font-size: 12px; color: #d9b06c; }
.chip {
  font-size: 11px; padding: 2px 10px; border-radius: 999px;
  border: 1px solid #3a3e46; text-transform: lowercase;
}
.chip.ok, .chip.done { color: #9fd7a8; border-color: #2c4a33; }
.chip.bad, .chip.failed { color: #f0a3a3; border-color: #4a2226; }
.chip.running { color: #d9b06c; border-color: #4a3a22; }
.assets, .render { padding: 12px; border-top: 1px solid #26282c; }
.assets .toolbar, .render .toolbar { border: 0; padding: 0 0 8px; }
.thumbs { display: flex; flex-wrap: wrap; gap: 8px; }
.thumbs figure {
  margin: 0; width: 64px; text-align: center; font-size: 10px; color: #9a9da4;
}
.thumbs img { width: 64px; height: 64px; object-fit: cover; border-radius: 4px; }
.thumbs .audio span { display: block; width: 64px; height: 64px; line-height: 64px; background: #1b1d21; border-radius: 4px; font-size: 22px; }
.thumbs figcaption { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.note { padding-top: 8px; font-size: 12px; color: #9a9da4; }
.renders { list-style: none; margin: 8px 0 0; padding: 0; font-size: 13px; }
.renders a { color: #8fb8e8; }
```

- [ ] **Step 7: Verify**

Run: `npm run typecheck` — Expected: exits 0.
Run: `npm test` — Expected: all tests pass (existing + edl-text).
Run: `npm run workbench:build` — Expected: build succeeds.

- [ ] **Step 8: Commit**

```bash
git add renderer/workbench
git commit -m "feat(workbench): two-pane UI with live validation, player preview, uploads, render panel"
```

---

### Task 5: End-to-end verification

**Files:** none new (fixes only if E2E finds bugs).

- [ ] **Step 1: Start the workbench**

Run in background: `npm run workbench` (server on 7787, vite on 5799).

- [ ] **Step 2: API-level E2E**

- `curl http://localhost:5799/api/assets` (through the vite proxy) → asset list.
- `POST http://localhost:7787/api/render` with `fixtures/montage.json` content as body → 202.
- Immediately POST again → 409.
- Poll `GET /api/render/status` until `done` (2–4 min) → `file` set.
- `GET /api/renders` → new `workbench-*.mp4` first; `GET /renders/<file>` → 200 MP4 bytes.

- [ ] **Step 3: UI-level check**

Load `http://localhost:5799`: editor shows fixture EDL, chip says "valid", player previews the montage. Break a cut (change `end_ms` 1000→940): chip flips to errors, beat violation listed, preview dims with "showing last valid". Fix it back: chip returns to valid.

- [ ] **Step 4: Stop processes, final commit if fixes were made**

```bash
git add renderer
git commit -m "fix(workbench): e2e fixes"   # only if changes exist
```

---

## Self-Review

1. **Spec coverage:** two-pane UI ✓ (T4); JSON editor + unified error panel ✓ (T2/T4); Player preview with real Reel + staticFile via publicDir ✓ (T1/T4); derived asset map ✓ (T2); upload with image filter + overwrite ✓ (T3/T4); render via CLI, single job, 409, status with logTail, renders list, MP4 serving ✓ (T3/T4); `npm run workbench` one command ✓ (T1); last-valid preview + stale marker ✓ (T4); tests for edlFromText/assetsFromFiles ✓ (T2); E2E flow ✓ (T5). Out-of-scope items respected (no editor library, no WebSockets, no delete UI).
2. **Placeholder scan:** none; all code complete.
3. **Type consistency:** `edlFromText(text, Set<string>) → {edl, errors}` used identically in T2 tests and T4 App; `AssetInfo {id, file, url}` matches server response (T3) and App/AssetStrip (T4); `Status.state` strings match server job states; import depths verified (`workbench/src/lib` → `../../../src/edl/…`, `workbench/src/components` → `../../../src/…`, `workbench/src` → `../../src/…` and `../../fixtures/montage.json`).
