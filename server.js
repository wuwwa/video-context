// video-context — one local Express server: serves the UI + a small JSON API
// that shells out to ffmpeg/yt-dlp to build Claude-ready frame packages.

import express from 'express';
import archiver from 'archiver';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { existsSync, readFileSync, createReadStream } from 'node:fs';
import { promises as fs } from 'node:fs';
import { exec } from 'node:child_process';

import { detectTools } from './services/tools.js';
import {
  createJob, getJob, jobView, reselect, rebuildSheet, outputRoot,
} from './services/jobs.js';
import { extractFrame } from './services/extract.js';
import { writeManifest } from './services/packager.js';
import { cueAt } from './services/subtitles.js';
import { slugify } from './services/slug.js';

// --- paths + minimal .env loader (no dependency) ---
const __dirname = path.dirname(fileURLToPath(import.meta.url));
(() => {
  const envPath = path.join(__dirname, '.env');
  if (!existsSync(envPath)) return;
  for (const line of readFileSync(envPath, 'utf8').split('\n')) {
    const m = line.match(/^\s*([\w.]+)\s*=\s*(.*)\s*$/);
    if (!m) continue;
    const val = m[2].replace(/^["']|["']$/g, '');
    if (process.env[m[1]] === undefined) process.env[m[1]] = val;
  }
})();

const PORT = parseInt(process.env.PORT || '5173', 10);
// Bind to localhost by default: this server reads arbitrary local paths and fetches
// arbitrary URLs with no auth, so it should not be exposed on the network. Set HOST
// (e.g. 0.0.0.0) only if you deliberately want LAN access.
const HOST = process.env.HOST || '127.0.0.1';

const app = express();
app.use(express.json({ limit: '2mb' }));

// --- health ---
app.get('/api/health', async (req, res) => {
  const t = await detectTools(req.query.refresh === '1');
  res.json({
    ok: t.ready,
    ffmpeg: t.ffmpeg,
    ffprobe: t.ffprobe,
    ytdlp: t.ytdlp,
    ready: t.ready,
    urlReady: t.urlReady,
    hints: {
      ytdlp: t.ytdlp.found ? null : 'pip install -U yt-dlp   (or)   winget install yt-dlp',
      ffmpeg: t.ffmpeg.found ? null : 'winget install Gyan.FFmpeg   (or)   set FFMPEG_PATH',
    },
  });
});

// --- create a job ---
app.post('/api/jobs', async (req, res) => {
  try {
    const b = req.body || {};
    if (b.sourceType === 'url' && !b.url) return res.status(400).json({ error: 'url required' });
    if (b.sourceType === 'local' && !b.path) return res.status(400).json({ error: 'path required' });
    if (b.sourceType !== 'url' && b.sourceType !== 'local') {
      return res.status(400).json({ error: 'sourceType must be "url" or "local"' });
    }
    const job = createJob(b);
    res.status(201).json({ jobId: job.id });
  } catch (err) {
    res.status(500).json({ error: String(err?.message || err) });
  }
});

// --- job status ---
app.get('/api/jobs/:id', (req, res) => {
  const job = getJob(req.params.id);
  if (!job) return res.status(404).json({ error: 'job not found' });
  res.json(jobView(job));
});

// --- serve a frame image ---
app.get('/api/jobs/:id/frames/:file', (req, res) => {
  const job = getJob(req.params.id);
  if (!job || !job.pkgDir) return res.status(404).end();
  const file = path.basename(req.params.file); // prevent traversal
  const full = path.join(job.pkgDir, 'frames', file);
  if (!full.startsWith(path.join(job.pkgDir, 'frames'))) return res.status(403).end();
  if (!existsSync(full)) return res.status(404).end();
  res.sendFile(full);
});

// --- serve the contact sheet ---
app.get('/api/jobs/:id/sheet', (req, res) => {
  const job = getJob(req.params.id);
  if (!job || !job.pkgDir || !job.sheet) return res.status(404).end();
  const full = path.join(job.pkgDir, path.basename(job.sheet)); // basename-guarded
  if (!existsSync(full)) return res.status(404).end();
  res.sendFile(full);
});

// --- manual: extract one extra frame at tSec into an existing job ---
app.post('/api/jobs/:id/manual', async (req, res) => {
  try {
    const job = getJob(req.params.id);
    if (!job || !job.videoPath) return res.status(404).json({ error: 'job not found or not ready' });
    const tSec = Number(req.body?.tSec);
    if (!(tSec >= 0)) return res.status(400).json({ error: 'tSec required' });
    if (job.window && (tSec < job.window.start - 1e-6 || tSec > job.window.end + 1e-6)) {
      return res.status(400).json({ error: `tSec outside window (${job.window.start}–${job.window.end}s)` });
    }
    const slug = slugify(job.title || 'video');
    const framesDir = path.join(job.pkgDir, 'frames');
    await fs.mkdir(framesDir, { recursive: true });
    const index = (job.frames.reduce((m, f) => Math.max(m, f.index), 0) || 0) + 1;
    const frame = await extractFrame({
      videoPath: job.videoPath, outDir: framesDir, slug, index, tSec,
      crop: req.body?.crop || null, ext: job.opts.ext === 'jpg' ? 'jpg' : 'png',
      offset: job.clipOffset || 0,
    });
    frame.transcript = cueAt(job.cues, tSec) || null;
    job.frames.push(frame);
    await rewrite(job);
    res.json(jobView(job));
  } catch (err) {
    res.status(500).json({ error: String(err?.message || err) });
  }
});

// --- reselect / prune ---
app.post('/api/jobs/:id/select', async (req, res) => {
  try {
    const job = getJob(req.params.id);
    if (!job) return res.status(404).json({ error: 'job not found' });
    const keep = (req.body?.keepIndexes || []).map(Number);
    await reselect(job, keep);
    res.json(jobView(job));
  } catch (err) {
    res.status(500).json({ error: String(err?.message || err) });
  }
});

// --- Save All: stream the package folder as a zip ---
app.get('/api/jobs/:id/package.zip', (req, res) => {
  const job = getJob(req.params.id);
  if (!job || !job.pkgDir || !existsSync(job.pkgDir)) return res.status(404).end();
  res.attachment(`${job.pkgName}.zip`);
  const archive = archiver('zip', { zlib: { level: 9 } });
  archive.on('error', () => { try { res.status(500).end(); } catch { /* */ } });
  archive.pipe(res);
  archive.directory(job.pkgDir, job.pkgName);
  archive.finalize();
});

// --- reveal output folder path (and open it in the OS file explorer) ---
app.get('/api/jobs/:id/reveal', (req, res) => {
  const job = getJob(req.params.id);
  if (!job || !job.pkgDir) return res.status(404).json({ error: 'job not found' });
  openInExplorer(job.pkgDir);
  res.json({ path: job.pkgDir });
});

// --- static UI ---
app.use(express.static(path.join(__dirname, 'public')));

// helper: rebuild the contact sheet + rewrite manifest after a manual add
async function rewrite(job) {
  await rebuildSheet(job);
  await writeManifest(job.pkgDir, {
    source: job.source, title: job.title, duration: job.duration, method: job.method,
    window: job.window, contactSheet: job.sheet, width: job.width, height: job.height,
    fps: job.fps, frames: job.frames,
  });
}

function openInExplorer(dir) {
  const cmd =
    process.platform === 'win32' ? `explorer "${dir}"`
    : process.platform === 'darwin' ? `open "${dir}"`
    : `xdg-open "${dir}"`;
  exec(cmd, () => { /* best effort; ignore errors */ });
}

app.listen(PORT, HOST, () => {
  console.log(`video-context running → http://localhost:${PORT}`);
  console.log(`output → ${outputRoot()}`);
});
