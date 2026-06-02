// Stitch the extracted frames into one labeled grid image (a contact sheet).
// Each cell is labeled "## · m:ss". This is an EXTRA artifact — the individual
// full-resolution frames remain the high-detail input for Claude; the sheet is a
// human-friendly overview/index (and is downscaled when fed to a model).
//
// drawtext on Windows is escaping-hostile (colons in font paths and timestamps break
// the filtergraph parser) and fontconfig (`font=`) is unreliable on the ffmpeg builds
// we target. We sidestep all of it by running ffmpeg with cwd = pkgDir and referencing
// everything by COLON-FREE RELATIVE paths under a temp dir: the label text comes from a
// `textfile=`, and the font is copied in and referenced via `fontfile=`. If anything
// still fails, we rebuild the grid without labels.

import path from 'node:path';
import os from 'node:os';
import { promises as fs, existsSync } from 'node:fs';
import { run, requireFfmpeg } from './tools.js';
import { fmtLabel } from './time.js';

const THUMB_W = () => parseInt(process.env.SHEET_THUMB_W || '480', 10);
const MAX_COLS = 4;
const TMP_DIR = '_sheet'; // temp, relative to pkgDir

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
  const tmpAbs = path.join(pkgDir, TMP_DIR);

  await fs.mkdir(tmpAbs, { recursive: true });

  // Copy a font into the temp dir so drawtext can reference it by a relative,
  // colon-free path (avoids fontconfig and Windows path-colon escaping entirely).
  let hasFont = false;
  const fontSrc = resolveFontPath();
  if (fontSrc) {
    try { await fs.copyFile(fontSrc, path.join(tmpAbs, 'font.ttf')); hasFont = true; } catch { /* unlabeled */ }
  }

  // One textfile per cell holds its label (colons render verbatim, not parsed).
  await Promise.all(
    list.map((f, i) =>
      fs.writeFile(path.join(tmpAbs, `${i}.txt`), `${String(f.index).padStart(2, '0')} · ${fmtLabel(f.tSec)}`, 'utf8')
    )
  );

  const buildArgs = (withLabels) => {
    const args = ['-y'];
    for (const f of list) args.push('-i', path.join(pkgDir, 'frames', f.file));
    const parts = [];
    list.forEach((_, i) => {
      const draw = withLabels
        ? `,drawtext=fontfile=${TMP_DIR}/font.ttf:textfile=${TMP_DIR}/${i}.txt:fontcolor=white:fontsize=22:box=1:boxcolor=black@0.55:boxborderw=6:x=10:y=10`
        : '';
      parts.push(`[${i}:v]scale=${thumb}:-2${draw}[v${i}]`);
    });
    parts.push(`${list.map((_, i) => `[v${i}]`).join('')}concat=n=${list.length}:v=1:a=0[cat]`);
    parts.push(`[cat]tile=${cols}x${rows}:padding=8:margin=8:color=#0e1116[out]`);
    args.push('-filter_complex', parts.join(';'), '-map', '[out]', '-frames:v', '1', '-update', '1');
    if (ext === 'jpg' || ext === 'jpeg') args.push('-q:v', '3');
    args.push(outPath);
    return args;
  };

  try {
    // cwd = pkgDir so the relative font/textfile paths resolve (and stay colon-free).
    let res = await run(ffmpeg, buildArgs(hasFont), { cwd: pkgDir, timeoutMs: 5 * 60 * 1000 });
    if (!res.ok || !existsSync(outPath)) {
      res = await run(ffmpeg, buildArgs(false), { cwd: pkgDir, timeoutMs: 5 * 60 * 1000 });
    }
    return res.ok && existsSync(outPath) ? outFile : null;
  } finally {
    await fs.rm(tmpAbs, { recursive: true, force: true }).catch(() => {});
  }
}

/** Find a usable .ttf for drawtext labels, or null (then the sheet is built unlabeled). */
function resolveFontPath() {
  const candidates = [
    process.env.SHEET_FONT,
    ...(process.platform === 'win32'
      ? ['C:/Windows/Fonts/arial.ttf', 'C:/Windows/Fonts/segoeui.ttf']
      : process.platform === 'darwin'
        ? ['/System/Library/Fonts/Supplemental/Arial.ttf', '/Library/Fonts/Arial.ttf']
        : [
            '/usr/share/fonts/truetype/dejavu/DejaVuSans.ttf',
            '/usr/share/fonts/dejavu/DejaVuSans.ttf',
            '/usr/share/fonts/TTF/DejaVuSans.ttf',
            path.join(os.homedir(), '.fonts/DejaVuSans.ttf'),
          ]),
  ].filter(Boolean);
  return candidates.find((p) => existsSync(p)) || null;
}
