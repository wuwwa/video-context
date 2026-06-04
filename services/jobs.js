// In-memory job store + the orchestration pipeline that turns a source
// (local file or URL) into a Claude-ready frame package.

import { promises as fs } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { probe } from './probe.js';
import { extractFrames, intervalTimestamps } from './extract.js';
import { detectScenes, selectScenes } from './scenes.js';
import { writeManifest, writeTranscript } from './packager.js';
import { buildContactSheet } from './contactsheet.js';
import { fetchMeta, download } from './ytdlp.js';
import { parseSubs, cueAt } from './subtitles.js';
import { slugify, shortId } from './slug.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, '..');

export function outputRoot() {
  const dir = process.env.OUTPUT_DIR || 'output';
  return path.isAbsolute(dir) ? dir : path.join(ROOT, dir);
}
function tmpRoot() {
  return path.join(ROOT, 'tmp');
}
function maxFrames() {
  return parseInt(process.env.MAX_FRAMES || '60', 10);
}

const jobs = new Map();

export function getJob(id) {
  return jobs.get(id);
}

/** Public view of a job (no internal fs paths beyond the output dir name). */
export function jobView(job) {
  if (!job) return null;
  return {
    id: job.id,
    status: job.status,
    method: job.method,
    source: job.source,
    title: job.title,
    duration: job.duration,
    window: job.window,
    progress: job.progress,
    log: job.log.slice(-40),
    error: job.error || null,
    pkgName: job.pkgName || null,
    sheet: job.sheet ? `/api/jobs/${job.id}/sheet` : null,
    frames: (job.frames || [])
      .slice()
      .sort((a, b) => a.tSec - b.tSec)
      .map((f) => ({
        index: f.index,
        tSec: f.tSec,
        file: f.file,
        url: `/api/jobs/${job.id}/frames/${encodeURIComponent(f.file)}`,
        transcript: f.transcript || null,
        sceneScore: f.sceneScore ?? null,
      })),
  };
}

function log(job, msg) {
  job.log.push(msg);
}

/** Update the structured progress the UI renders as a bar. ratio in [0,1] or null. */
function setProgress(job, phase, ratio = null, detail = '') {
  job.progress = {
    phase,
    ratio: ratio == null ? null : Math.max(0, Math.min(1, ratio)),
    detail,
  };
}

/** Replace the last log line if it starts with prefix, else push a new one. */
function logLive(job, prefix, msg) {
  const last = job.log[job.log.length - 1];
  if (last && last.startsWith(prefix)) job.log[job.log.length - 1] = msg;
  else job.log.push(msg);
}

/**
 * Create a job and start running it (async, non-blocking).
 * opts = { sourceType:'url'|'local', url?, path?, method, budget?, every?, start?, end?, wantSubs?, crop?, ext?, jpegQuality? }
 */
export function createJob(opts) {
  const id = shortId(Date.now());
  const job = {
    id,
    status: 'queued',
    method: opts.method || 'scene',
    sourceType: opts.sourceType,
    source: opts.url || opts.path,
    title: null,
    duration: 0,
    width: 0,
    height: 0,
    fps: 0,
    clipOffset: 0,   // file start in source seconds (for windowed yt-dlp clips)
    window: null,    // { start, end } absolute source seconds, or null for full video
    progress: { phase: 'queued', ratio: null, detail: '' },
    log: [],
    frames: [],
    cues: [],
    error: null,
    pkgDir: null,
    pkgName: null,
    sheet: null,     // contact-sheet basename once built
    videoPath: null,
    opts,
  };
  jobs.set(id, job);
  run(job).catch((err) => {
    job.status = 'error';
    job.error = String(err?.message || err);
    setProgress(job, 'error', null, job.error);
    log(job, `ERROR: ${job.error}`);
  });
  return job;
}

async function run(job) {
  const o = job.opts;
  job.status = 'preparing';
  setProgress(job, 'preparing');

  // --- requested clip window (absolute source seconds) ---
  const winStart = Math.max(0, Number(o.start) || 0);
  const winEndReq = o.end != null && Number(o.end) > 0 ? Number(o.end) : null;
  const hasWindow = winStart > 0 || winEndReq != null;
  const wantSubs = o.wantSubs !== false; // default on

  // --- resolve source video on disk ---
  if (o.sourceType === 'url') {
    log(job, 'Reading video info…');
    setProgress(job, 'metadata');
    const meta = await fetchMeta(o.url);
    job.title = meta.title;
    job.duration = meta.duration;
    const dlDir = path.join(tmpRoot(), job.id);
    log(job, hasWindow ? 'Downloading clip (≤720p)…' : 'Downloading (≤720p)…');
    job.status = 'downloading';
    setProgress(job, 'downloading');
    const { videoPath, subPath, requestedStart } = await download(o.url, dlDir, {
      start: hasWindow ? winStart : null,
      end: hasWindow ? winEndReq : null,
      wantSubs,
      onProgress: (line) => {
        for (const raw of line.split(/\r?\n/)) {
          const s = raw.trim();
          if (!s) continue;
          const pm = s.match(/\[download\]\s+([0-9.]+)%\s*(.*)$/);
          if (pm) {
            // Live percentage line (updates in place); detail = "of 10MiB at 1.5MiB/s ETA 00:05".
            const pct = parseFloat(pm[1]);
            const detail = pm[2].replace(/\s+/g, ' ').trim();
            setProgress(job, 'downloading', pct / 100, detail);
            logLive(job, 'Downloading…', `Downloading… ${pct.toFixed(1)}%${detail ? ` · ${detail}` : ''}`);
          } else if (/^\[(Merger|VideoRemuxer|ExtractAudio|VideoConvertor|Fixup)/.test(s) || /Merging|Deleting original|Splic/i.test(s)) {
            // Post-download phase (merge/remux/fixup) emits no % — show an animated
            // "processing…" bar so the UI doesn't look frozen at 100%, and log the line.
            setProgress(job, 'processing');
            log(job, s);
          } else if (/^\[(download|info)\]/.test(s)) {
            // Milestone lines (Destination, format info, etc.) — keep them in the log.
            log(job, s);
          }
        }
      },
    });
    job.videoPath = videoPath;
    job.subPath = subPath;
    job._requestedStart = requestedStart; // non-null only when a windowed section was fetched
  } else {
    const p = o.path;
    if (!p) throw new Error('No local path provided');
    try { await fs.access(p); } catch { throw new Error(`File not found: ${p}`); }
    job.videoPath = p;
    job.title = path.basename(p);
    // sidecar subtitle?
    if (wantSubs) {
      const base = p.replace(/\.[^.]+$/, '');
      for (const cand of [`${base}.vtt`, `${base}.srt`, `${base}.en.vtt`]) {
        try { await fs.access(cand); job.subPath = cand; break; } catch { /* none */ }
      }
    }
  }

  // --- probe ---
  log(job, 'Reading video…');
  setProgress(job, 'probing');
  const meta = await probe(job.videoPath);
  const clipDur = meta.duration || job.duration; // duration of the file actually on disk
  job.width = meta.width;
  job.height = meta.height;
  job.fps = meta.fps;
  if (!job.title) job.title = meta.title;

  // --- resolve clip offset + effective absolute window ---
  // For a windowed yt-dlp download the file's timeline resets toward 0; map file-local
  // time to absolute source time via clipOffset = winStart - fileStart. Local files and
  // full downloads keep clipOffset = 0 and are bounded by selection only.
  let winEnd;
  if (job._requestedStart != null) {
    job.clipOffset = job._requestedStart - (meta.startTime || 0);
    winEnd = winStart + clipDur;        // absolute end of the fetched section
    job.duration = winEnd;              // report source duration up to the window end
  } else {
    job.clipOffset = 0;
    job.duration = clipDur;
    winEnd = winEndReq != null ? Math.min(winEndReq, clipDur) : clipDur;
  }
  if (hasWindow) job.window = { start: winStart, end: winEnd };

  // --- subtitles ---
  if (job.subPath) {
    log(job, 'Reading subtitles…');
    setProgress(job, 'subtitles');
    try {
      job.cues = await parseSubs(job.subPath);
      log(job, `Read ${job.cues.length} subtitle cues.`);
    } catch { job.cues = []; }
  }

  // --- choose timestamps by method (all in absolute source time, bounded by window) ---
  const budget = Math.min(Math.max(parseInt(o.budget || 15, 10), 1), maxFrames());
  const inWindow = (t) => t >= winStart - 1e-6 && t <= winEnd + 1e-6;
  let timestamps = [];
  let scoreByTime = new Map();

  if (job.method === 'manual') {
    timestamps = (o.timestamps || []).map(Number).filter((t) => t >= 0 && inWindow(t));
    timestamps = [...new Set(timestamps)].sort((a, b) => a - b).slice(0, maxFrames());
    if (!timestamps.length) {
      throw new Error(hasWindow
        ? 'No timestamps fall within the clip window.'
        : 'Add at least one timestamp.');
    }
  } else if (job.method === 'interval') {
    const step = parseFloat(o.every || 30);
    timestamps = intervalTimestamps({ start: winStart, end: winEnd, step, duration: winEnd }).slice(0, maxFrames());
    if (!timestamps.length) throw new Error('Interval produced no frames. Check the values.');
  } else {
    // scene — analyze only the window where possible, then map results to absolute time
    job.status = 'analyzing';
    log(job, 'Analyzing scenes…');
    // Indeterminate: a scene-analysis pass filters its output, so ffmpeg reports no
    // reliable decode position (time=N/A) to drive a percentage. The bar animates.
    setProgress(job, 'analyzing');
    const localWindowed = o.sourceType === 'local' && hasWindow;
    const opts = localWindowed ? { ss: winStart, dur: winEnd - winStart } : {};
    const base = localWindowed ? winStart : job.clipOffset; // window-relative+winStart, or file-local+clipOffset
    const raw = await detectScenes(job.videoPath, parseFloat(o.threshold || 0.3), opts);
    const scenes = raw.map((s) => ({ tSec: s.tSec + base, score: s.score }));
    log(job, `Found ${scenes.length} scenes.`);
    const chosen = selectScenes(scenes, { budget, start: winStart, end: winEnd });
    timestamps = chosen.map((c) => c.tSec);
    chosen.forEach((c) => { if (c.score != null) scoreByTime.set(c.tSec, c.score); });
  }

  // Seeking at/after the media end yields no frame (fast seek discards up to the target),
  // so nudge any timestamp there back by one frame. (Absolute end = clipOffset + clipDur.)
  const lastT = job.clipOffset + clipDur - (job.fps ? 1 / job.fps : 0.1);
  timestamps = [...new Set(timestamps.map((t) => (t > lastT ? Math.max(0, lastT) : t)))]
    .sort((a, b) => a - b);

  // --- prepare package dir ---
  const slug = slugify(job.title || 'video');
  job.pkgName = `${slug}__${job.id}`;
  job.pkgDir = path.join(outputRoot(), job.pkgName);
  const framesDir = path.join(job.pkgDir, 'frames');
  await fs.mkdir(framesDir, { recursive: true });

  // --- extract ---
  job.status = 'extracting';
  setProgress(job, 'extracting', 0);
  const ext = o.ext === 'jpg' || o.ext === 'jpeg' ? 'jpg' : 'png';
  const frames = await extractFrames({
    videoPath: job.videoPath,
    outDir: framesDir,
    slug,
    timestamps,
    crop: o.crop || null,
    ext,
    offset: job.clipOffset,
    onProgress: ({ done, total }) => {
      setProgress(job, 'extracting', total ? done / total : null);
      logLive(job, 'Extracting ', `Extracting ${done}/${total}…`);
    },
  });

  // attach transcript + scene score per frame
  for (const f of frames) {
    f.transcript = cueAt(job.cues, f.tSec) || null;
    if (scoreByTime.has(f.tSec)) f.sceneScore = scoreByTime.get(f.tSec);
  }
  job.frames = frames;

  // --- package: contact sheet (best-effort) then manifest + transcript ---
  job.status = 'packaging';
  setProgress(job, 'packaging');
  log(job, 'Building contact sheet…');
  try {
    job.sheet = await buildContactSheet(job.pkgDir, job.frames, { ext });
    log(job, job.sheet ? 'Built contact sheet.' : 'Skipped contact sheet.');
  } catch (err) {
    log(job, `Contact sheet failed: ${String(err?.message || err)}`);
  }

  log(job, 'Writing files…');
  await writeManifest(job.pkgDir, manifestArgs(job));
  if (job.cues.length) {
    // Restrict the transcript to the window so it matches the frames.
    const cues = hasWindow
      ? job.cues.filter((c) => c.end >= winStart && c.start <= winEnd)
      : job.cues;
    if (cues.length) await writeTranscript(job.pkgDir, cues);
  }

  job.status = 'done';
  setProgress(job, 'done', 1);
  log(job, `Done. ${job.frames.length} frames in ${job.pkgName}.`);
}

/** Shared manifest argument shape so run/reselect/manual stay in sync. */
function manifestArgs(job) {
  return {
    source: job.source, title: job.title, duration: job.duration, method: job.method,
    window: job.window, contactSheet: job.sheet, width: job.width, height: job.height,
    fps: job.fps, frames: job.frames,
  };
}

/** Re-prune which frames stay in the package and rewrite the manifest. */
export async function reselect(job, keepIndexes) {
  const keep = new Set(keepIndexes);
  const remaining = job.frames.filter((f) => keep.has(f.index));
  if (!remaining.length) throw new Error('Keep at least one frame.');
  // delete dropped frame files
  const framesDir = path.join(job.pkgDir, 'frames');
  for (const f of job.frames) {
    if (!keep.has(f.index)) {
      try { await fs.unlink(path.join(framesDir, f.file)); } catch { /* ignore */ }
    }
  }
  // renumber sequentially
  remaining.sort((a, b) => a.tSec - b.tSec).forEach((f, i) => { f.index = i + 1; });
  job.frames = remaining;
  await rebuildSheet(job);
  await writeManifest(job.pkgDir, manifestArgs(job));
  return job;
}

/** Rebuild the contact sheet to match the current frame set (best-effort). */
export async function rebuildSheet(job) {
  if (!job.pkgDir) return;
  const ext = job.opts?.ext === 'jpg' || job.opts?.ext === 'jpeg' ? 'jpg' : 'png';
  try { job.sheet = await buildContactSheet(job.pkgDir, job.frames, { ext }); }
  catch { /* best-effort; keep the previous sheet */ }
}
