// Parse WebVTT/SRT into cues and align them to frame timestamps.

import { promises as fs } from 'node:fs';

/** Parse a .vtt (or .srt) file into [{ start, end, text }] (seconds). */
export async function parseSubs(subPath) {
  let raw;
  try { raw = await fs.readFile(subPath, 'utf8'); } catch { return []; }
  const blocks = raw.replace(/\r/g, '').split(/\n\n+/);
  const cues = [];
  for (const block of blocks) {
    const lines = block.split('\n').filter(Boolean);
    const tline = lines.find((l) => l.includes('-->'));
    if (!tline) continue;
    const m = tline.match(/(\d{1,2}:\d{2}:\d{2}[.,]\d{1,3}|\d{1,2}:\d{2}[.,]\d{1,3})\s*-->\s*(\d{1,2}:\d{2}:\d{2}[.,]\d{1,3}|\d{1,2}:\d{2}[.,]\d{1,3})/);
    if (!m) continue;
    const start = tcToSec(m[1]);
    const end = tcToSec(m[2]);
    const textLines = lines.filter((l) => l !== tline && !/^\d+$/.test(l) && !/^WEBVTT/.test(l));
    const text = textLines.join(' ').replace(/<[^>]+>/g, '').replace(/\s+/g, ' ').trim();
    if (text) cues.push({ start, end, text });
  }
  // de-dup consecutive identical text (auto-subs repeat heavily)
  const out = [];
  for (const c of cues) {
    const prev = out[out.length - 1];
    if (prev && prev.text === c.text) { prev.end = c.end; continue; }
    out.push(c);
  }
  return out;
}

function tcToSec(tc) {
  const t = tc.replace(',', '.');
  const parts = t.split(':').map(Number);
  let s = 0;
  for (const p of parts) s = s * 60 + p;
  return s;
}

/** Find the cue text covering (or nearest to) time t. */
export function cueAt(cues, t, window = 3) {
  if (!cues || !cues.length) return null;
  let covering = cues.find((c) => t >= c.start && t <= c.end);
  if (covering) return covering.text;
  // nearest within window seconds
  let best = null, bestD = Infinity;
  for (const c of cues) {
    const d = Math.min(Math.abs(c.start - t), Math.abs(c.end - t));
    if (d < bestD) { bestD = d; best = c; }
  }
  return best && bestD <= window ? best.text : null;
}
