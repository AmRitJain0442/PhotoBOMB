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
