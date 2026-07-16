import express from 'express';
import multer from 'multer';
import {spawn} from 'node:child_process';
import {existsSync, mkdirSync, readdirSync, statSync, unlinkSync, writeFileSync} from 'node:fs';
import {mkdtemp, readFile, writeFile} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {basename, dirname, extname, join, resolve} from 'node:path';
import {fileURLToPath} from 'node:url';

const IMAGE_EXT = new Set(['.jpg', '.jpeg', '.png', '.webp', '.svg']);
const MEDIA_EXT = new Set([...IMAGE_EXT, '.wav', '.mp3', '.m4a']);
const AUDIO_EXT = new Set(['.mp3', '.wav']);

const newRunId = () => `p${Date.now()}${Math.random().toString(36).slice(2, 5)}`;

/**
 * Build the app. Injectable for tests:
 *  - pipelineImpl: {run(opts, onProgress), revise(opts, onProgress)} -> RunResult
 *  - ingestImpl: (audioFilePath) -> track record for index.json
 *  - checkCredentials: () -> {ok, message?}
 *  - roots: {rendererRoot, repoRoot}
 */
export function createApp({pipelineImpl, ingestImpl, checkCredentials, roots}) {
  const {rendererRoot, repoRoot} = roots;
  const assetsDir = join(rendererRoot, 'public', 'assets');
  const outDir = join(rendererRoot, 'out');
  const audioLibDir = join(repoRoot, 'audio-library');
  const audioIndexPath = join(audioLibDir, 'index.json');
  mkdirSync(assetsDir, {recursive: true});
  mkdirSync(outDir, {recursive: true});
  mkdirSync(audioLibDir, {recursive: true});

  const app = express();
  app.use(express.json({limit: '5mb'}));

  // ---- assets --------------------------------------------------------------

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

  app.delete('/api/assets/:file', (req, res) => {
    const f = basename(req.params.file);
    if (!f || f !== req.params.file || !MEDIA_EXT.has(extname(f).toLowerCase())) {
      return res.status(400).json({error: 'bad file name'});
    }
    const p = resolve(assetsDir, f);
    if (!p.startsWith(resolve(assetsDir)) || !existsSync(p)) {
      return res.status(404).end();
    }
    unlinkSync(p);
    const id = f.replace(/\.[^.]+$/, '');
    for (const derived of [
      join(assetsDir, 'cutouts', `${id}.png`),
      join(assetsDir, 'enhanced', `${id}.jpg`),
      join(assetsDir, 'clips', `${id}.mp4`),
    ]) {
      if (existsSync(derived)) unlinkSync(derived);
    }
    res.status(204).end();
  });

  // ---- audio library -------------------------------------------------------

  const readAudioIndex = async () => {
    try {
      const parsed = JSON.parse(await readFile(audioIndexPath, 'utf8'));
      return Array.isArray(parsed) ? parsed : [];
    } catch {
      return [];
    }
  };

  app.get('/api/audio', async (_req, res) => {
    res.json(await readAudioIndex());
  });

  const audioUpload = multer({
    storage: multer.diskStorage({
      destination: audioLibDir,
      filename: (_req, file, cb) =>
        cb(null, basename(file.originalname).replace(/[^\w.\-]/g, '_')),
    }),
    fileFilter: (_req, file, cb) =>
      cb(null, AUDIO_EXT.has(extname(file.originalname).toLowerCase())),
  });

  app.post('/api/audio', audioUpload.single('file'), async (req, res) => {
    if (!req.file) {
      return res.status(400).json({error: 'bad_file', message: 'Songs must be MP3 or WAV files.'});
    }
    try {
      const entry = await ingestImpl(join(audioLibDir, req.file.filename));
      const index = await readAudioIndex();
      const next = [...index.filter((t) => t.id !== entry.id), entry];
      await writeFile(audioIndexPath, JSON.stringify(next, null, 2), 'utf8');
      res.json(entry);
    } catch (e) {
      res.status(422).json({
        error: 'ingest_failed',
        message: "We couldn't read that song. Try a different MP3 or WAV.",
        detail: String(e?.message ?? e).slice(0, 500),
      });
    }
  });

  // ---- pipeline ------------------------------------------------------------

  const pipeJob = {state: 'idle', stage: null, runId: null, error: null, code: null, result: null};

  const startJob = (runId, work) => {
    Object.assign(pipeJob, {
      state: 'running',
      stage: null,
      runId,
      error: null,
      code: null,
      result: null,
    });
    const onProgress = (stage, st) => {
      if (st === 'running') pipeJob.stage = stage;
    };
    work(onProgress)
      .then((result) => {
        Object.assign(pipeJob, {state: 'done', runId: result.runId, result});
      })
      .catch((e) => {
        Object.assign(pipeJob, {
          state: 'failed',
          error: String(e?.message ?? e).slice(0, 2000),
          code: e?.code ?? 'unknown',
        });
      });
  };

  app.post('/api/pipeline/run', (req, res) => {
    if (pipeJob.state === 'running') {
      return res.status(409).json({error: 'busy', message: 'A reel is already developing.'});
    }
    const cred = checkCredentials();
    if (!cred.ok) {
      return res.status(422).json({error: 'setup', message: cred.message});
    }
    const {track = 'auto', avoid, style = 'classic', enhance = false} = req.body ?? {};
    const runId = newRunId();
    startJob(runId, (onProgress) =>
      pipelineImpl.run({track, avoid, style, enhance, runId}, onProgress),
    );
    res.status(202).json({runId});
  });

  app.post('/api/pipeline/revise', (req, res) => {
    if (pipeJob.state === 'running') {
      return res.status(409).json({error: 'busy', message: 'A reel is already developing.'});
    }
    const cred = checkCredentials();
    if (!cred.ok) {
      return res.status(422).json({error: 'setup', message: cred.message});
    }
    const {runId, pin, removeAsset} = req.body ?? {};
    if (!runId || (!pin && !removeAsset)) {
      return res.status(400).json({error: 'body must be {runId, pin? | removeAsset?}'});
    }
    const asRunId = newRunId();
    startJob(asRunId, (onProgress) =>
      pipelineImpl.revise({runId, pin, removeAsset, asRunId}, onProgress),
    );
    res.status(202).json({runId: asRunId});
  });

  app.get('/api/pipeline/status', (_req, res) => {
    res.json({
      state: pipeJob.state,
      stage: pipeJob.stage,
      runId: pipeJob.runId,
      error: pipeJob.error,
      code: pipeJob.code,
    });
  });

  app.get('/api/pipeline/result/:runId', async (req, res) => {
    const runId = basename(req.params.runId);
    if (pipeJob.result && pipeJob.result.runId === runId) {
      return res.json(pipeJob.result);
    }
    const dir = join(repoRoot, 'out', 'pipeline', runId);
    try {
      const [edl, plan, meta] = await Promise.all([
        readFile(join(dir, 'edl.json'), 'utf8').then(JSON.parse),
        readFile(join(dir, 'production_plan.json'), 'utf8').then(JSON.parse),
        readFile(join(dir, 'meta.json'), 'utf8').then(JSON.parse),
      ]);
      res.json({runId, edl, plan, meta});
    } catch {
      res.status(404).json({error: 'unknown run'});
    }
  });

  // ---- render (unchanged job model) ---------------------------------------

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
    const outName = `darkroom-${ts}.mp4`;
    const propsPath = join(outDir, `darkroom-${ts}.json`);
    writeFileSync(propsPath, JSON.stringify({edl, assets}));
    Object.assign(job, {state: 'running', file: outName, error: null, log: ''});
    const child = spawn(
      'npx',
      ['remotion', 'render', 'Reel', `out/${outName}`, `--props=${propsPath}`, '--log=error'],
      {cwd: rendererRoot, shell: true},
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

  return app;
}

// ---- entry: real implementations ------------------------------------------

const isMain =
  process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url);

if (isMain) {
  const rendererRoot = join(dirname(fileURLToPath(import.meta.url)), '..');
  const repoRoot = join(rendererRoot, '..');

  // credential autoset: fall back to the checked-out service-account key
  const keyPath = join(repoRoot, 'my-product-sa-key.json');
  if (!process.env.GOOGLE_APPLICATION_CREDENTIALS && existsSync(keyPath)) {
    process.env.GOOGLE_APPLICATION_CREDENTIALS = keyPath;
  }

  const orchestratorDist = join(repoRoot, 'orchestrator', 'dist', 'orchestrator', 'src');
  const {runPipeline, revisePipeline, makeSpawnPy, resolveDirectorModel} = await import(
    `file://${orchestratorDist.replaceAll('\\', '/')}/pipeline.js`
  );
  const {vertexTransport} = await import(
    `file://${orchestratorDist.replaceAll('\\', '/')}/gemini.js`
  );

  const deps = {
    transport: vertexTransport,
    repoRoot,
    directorModel: resolveDirectorModel(process.env),
    spawnPy: makeSpawnPy(repoRoot),
  };
  const photosDir = join(rendererRoot, 'public', 'assets');

  const spawnPy = makeSpawnPy(repoRoot);
  const ingestImpl = async (audioFile) => {
    const tmp = await mkdtemp(join(tmpdir(), 'darkroom-ingest-'));
    const outJson = join(tmp, 'track.json');
    const {code, stdout} = await spawnPy(join('analysis', 'ingest_audio.py'), [
      '--track',
      audioFile,
      '--cache',
      join(repoRoot, 'out', 'cache'),
      '--out',
      outJson,
      '--describe',
    ]);
    if (code !== 0) throw new Error(stdout.slice(0, 1000));
    return JSON.parse(await readFile(outJson, 'utf8'));
  };

  const app = createApp({
    roots: {rendererRoot, repoRoot},
    pipelineImpl: {
      run: ({track, avoid, style, enhance, runId}, onProgress) =>
        runPipeline({photosDir, track, avoid, style, enhance, runId, deps}, onProgress),
      revise: ({runId, pin, removeAsset, asRunId}, onProgress) =>
        revisePipeline({runId, pin, removeAsset, asRunId, deps}, onProgress),
    },
    ingestImpl,
    checkCredentials: () =>
      process.env.GOOGLE_APPLICATION_CREDENTIALS
        ? {ok: true}
        : {
            ok: false,
            message:
              'Darkroom is not connected to its AI yet. Put my-product-sa-key.json in the project folder and restart.',
          },
  });

  app.listen(7787, () => {
    console.log('darkroom server on http://localhost:7787');
  });
}
