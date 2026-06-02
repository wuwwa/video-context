// Stitch the extracted frames into one labeled grid image (a contact sheet).
// Each cell is labeled "## · m:ss". This is an EXTRA artifact — the individual
// full-resolution frames remain the high-detail input for Claude; the sheet is a
// human-friendly overview/index (and is downscaled when fed to a model).
//
// drawtext on Windows is escaping-hostile (colons in font paths and timestamps break
// the filtergraph parser). We sidestep all of it by: (1) using a fontconfig family name
// (font=) instead of a fontfile path, and (2) reading each label from a textfile via a
// colon-free RELATIVE path (ffmpeg runs with cwd = pkgDir). Labels then render verbatim,
// colons and all. If anything still fails, we rebuild the grid without labels.

import path from 'node:path';
import { promises as fs, existsSync } from 'node:fs';
import { run, requireFfmpeg } from './tools.js';
import { fmtLabel } from './time.js';

const THUMB_W = () => parseInt(process.env.SHEET_THUMB_W || '480', 10);
const MAX_COLS = 4;
const LABEL_DIR = '_sheet'; // temp, relative to pkgDir

/**
 * Build pkgDir/contactsheet.<ext> from the job's frames.
 * frames = [{ index, tSec, file }] where file is the basename under frames/.
 * Returns the sheet basename, or null if it couldn't be built.
 */
export async function buildContactSheet(pkgDir, frames, { ext = 'jpg' } = {}) {
  const list = [...(frames || [])].sort((a, b) => a.tSec - b.tSec);
  if (!list.length) return null;
  const ffmpeg = await requireFfmpeg();
  const thumb = THUMB_W();
  const cols = Math.min(MAX_COLS, list.length);
  const rows = Math.ceil(list.length / cols);
  const outFile = `contactsheet.${ext}`;
  const outPath = path.join(pkgDir, outFile);
  const family = fontFamily();

  // Write each cell's label to a textfile (colon-safe), referenced by relative path.
  await fs.mkdir(path.join(pkgDir, LABEL_DIR), { recursive: true });
  await Promise.all(
    list.map((f, i) =>
      fs.writeFile(
        path.join(pkgDir, LABEL_DIR, `${i}.txt`),
        `${String(f.index).padStart(2, '0')} · ${fmtLabel(f.tSec)}`,
        'utf8'
      )
    )
  );

  const buildArgs = (withLabels) => {
    const args = ['-y'];
    for (const f of list) args.push('-i', path.join(pkgDir, 'frames', f.file));
    const parts = [];
    list.forEach((_, i) => {
      const draw = withLabels
        ? `,drawtext=font='${family}':textfile=${LABEL_DIR}/${i}.txt:fontcolor=white:fontsize=22:box=1:boxcolor=black@0.55:boxborderw=6:x=10:y=10`
        : '';
      parts.push(`[${i}:v]scale=${thumb}:-2${draw}[v${i}]`);
    });
    parts.push(`${list.map((_, i) => `[v${i}]`).join('')}concat=n=${list.length}:v=1:a=0[cat]`);
    parts.push(`[cat]tile=${cols}x${rows}:padding=8:margin=8:color=#0e1116[out]`);
    args.push('-filter_complex', parts.join(';'), '-map', '[out]', '-frames:v', '1');
    if (ext === 'jpg' || ext === 'jpeg') args.push('-q:v', '3');
    args.push(outPath);
    return args;
  };

  try {
    // cwd = pkgDir so the relative textfile paths resolve (and stay colon-free).
    let res = await run(ffmpeg, buildArgs(true), { cwd: pkgDir, timeoutMs: 5 * 60 * 1000 });
    if (!res.ok || !existsSync(outPath)) {
      res = await run(ffmpeg, buildArgs(false), { cwd: pkgDir, timeoutMs: 5 * 60 * 1000 });
    }
    return res.ok && existsSync(outPath) ? outFile : null;
  } finally {
    await fs.rm(path.join(pkgDir, LABEL_DIR), { recursive: true, force: true }).catch(() => {});
  }
}

/** Pick a fontconfig family for drawtext (no path → no colon-escaping pain). */
function fontFamily() {
  if (process.env.SHEET_FONT) return process.env.SHEET_FONT;
  if (process.platform === 'win32' || process.platform === 'darwin') return 'Arial';
  return 'DejaVu Sans';
}
