// ffmpeg frame extraction. All modes converge on extractFrames(timestamps).

import path from 'node:path';
import { run, requireFfmpeg } from './tools.js';
import { fmtFile, fmtFfmpeg } from './time.js';

const LONG_EDGE = () => parseInt(process.env.FRAME_LONG_EDGE || '1568', 10);

/**
 * Build the -vf filter chain: optional crop (fractions of frame) then downscale
 * so the long edge is at most FRAME_LONG_EDGE, never upscaling.
 * crop = {x,y,w,h} as fractions in [0,1], or null.
 */
function buildFilter(crop) {
  const parts = [];
  if (crop && crop.w > 0 && crop.h > 0) {
    // ffmpeg crop=w:h:x:y, expressed against input dims via iw/ih.
    const x = clamp01(crop.x), y = clamp01(crop.y);
    const w = clamp01(crop.w), h = clamp01(crop.h);
    parts.push(`crop=iw*${w}:ih*${h}:iw*${x}:ih*${y}`);
  }
  const le = LONG_EDGE();
  if (le > 0) {
    // Scale so the longer side == le, only if larger; keep aspect; even dims.
    parts.push(
      `scale='if(gt(iw,ih),min(${le},iw),-2)':'if(gt(iw,ih),-2,min(${le},ih))':flags=lanczos`
    );
  }
  return parts.join(',');
}

function clamp01(n) {
  return Math.max(0, Math.min(1, Number(n) || 0));
}

/**
 * Extract one frame at time t (seconds) from videoPath into outDir.
 * Returns { index, tSec, label, file } where file is the basename written.
 * Uses input-seek (-ss before -i) for speed + accuracy on keyframes.
 *
 * tSec is the ABSOLUTE source time (used for the filename/label). `offset` is the
 * file's start in source time (e.g. a windowed yt-dlp clip that resets to 0): the
 * actual ffmpeg seek is tSec - offset, while the stamp/file stay absolute.
 */
export async function extractFrame({ videoPath, outDir, slug, index, tSec, crop, ext = 'png', jpegQuality = 3, offset = 0 }) {
  const ffmpeg = await requireFfmpeg();
  const stamp = fmtFile(tSec);
  const idx = String(index).padStart(4, '0');
  const file = `${slug}__${idx}__${stamp}.${ext}`;
  const outPath = path.join(outDir, file);
  const vf = buildFilter(crop);

  const seek = Math.max(0, tSec - offset);
  const args = ['-y', '-ss', fmtFfmpeg(seek), '-i', videoPath, '-frames:v', '1'];
  if (vf) args.push('-vf', vf);
  if (ext === 'jpg' || ext === 'jpeg') args.push('-q:v', String(jpegQuality));
  args.push(outPath);

  const res = await run(ffmpeg, args, { timeoutMs: 60000 });
  if (!res.ok) {
    throw new Error(`ffmpeg frame @ ${stamp} failed: ${res.stderr.trim().split('\n').slice(-2).join(' ')}`);
  }
  return { index, tSec, file, stamp };
}

/**
 * Extract many frames. timestamps = sorted unique seconds.
 * onProgress({done,total,tSec}) is called as each completes.
 * Returns array of { index, tSec, file, stamp }.
 */
export async function extractFrames({ videoPath, outDir, slug, timestamps, crop, ext = 'png', jpegQuality = 3, offset = 0, onProgress }) {
  const out = [];
  for (let i = 0; i < timestamps.length; i++) {
    const tSec = timestamps[i];
    const frame = await extractFrame({
      videoPath, outDir, slug, index: i + 1, tSec, crop, ext, jpegQuality, offset,
    });
    out.push(frame);
    if (onProgress) onProgress({ done: i + 1, total: timestamps.length, tSec });
  }
  return out;
}

/**
 * Build a list of timestamps for interval mode: start..end every `step` seconds.
 * `start`/`end` are absolute source times defining the window; an explicit `end`
 * is honored as-is (the caller resolves it against the clip), with `duration` only
 * used as the fallback end when `end` is null.
 */
export function intervalTimestamps({ start = 0, end, step, duration }) {
  const s = Math.max(0, start ?? 0);
  const e = end != null ? end : (duration ?? 0);
  const out = [];
  if (!(step > 0) || !(e > s)) return out;
  for (let t = s; t <= e + 1e-6; t += step) out.push(Math.round(t * 1000) / 1000);
  return out;
}
