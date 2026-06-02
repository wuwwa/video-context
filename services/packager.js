// Write the Claude-ready package: manifest.md + manifest.json from a frame list.

import { promises as fs } from 'node:fs';
import path from 'node:path';
import { fmtLabel } from './time.js';

/**
 * Write manifest.md and manifest.json into pkgDir.
 * job = {
 *   source, title, duration, method, fps, width, height,
 *   window?: { start, end },   // optional clip window in source seconds
 *   contactSheet?: string,     // optional contact-sheet basename in pkgDir
 *   frames: [{ index, tSec, file, stamp, sceneScore?, transcript? }],
 * }
 * frames are stored under pkgDir/frames/<file>; manifest references "frames/<file>".
 */
export async function writeManifest(pkgDir, job, generatedAt = new Date()) {
  const frames = [...job.frames].sort((a, b) => a.tSec - b.tSec);
  const win = windowOf(job.window);

  const json = {
    source: job.source,
    title: job.title || null,
    duration: job.duration || null,
    durationLabel: job.duration ? fmtLabel(job.duration) : null,
    method: job.method,
    ...(win ? { window: { start: win.start, end: win.end, label: win.label } } : {}),
    resolution: job.width && job.height ? `${job.width}x${job.height}` : null,
    fps: job.fps || null,
    ...(job.contactSheet ? { contactSheet: job.contactSheet } : {}),
    generated: generatedAt.toISOString(),
    frameCount: frames.length,
    frames: frames.map((f) => ({
      index: f.index,
      tSec: Math.round(f.tSec * 1000) / 1000,
      label: fmtLabel(f.tSec),
      file: `frames/${f.file}`,
      ...(f.sceneScore != null ? { sceneScore: Math.round(f.sceneScore * 1000) / 1000 } : {}),
      ...(f.transcript ? { transcript: f.transcript } : {}),
    })),
  };

  await fs.writeFile(path.join(pkgDir, 'manifest.json'), JSON.stringify(json, null, 2), 'utf8');

  // --- markdown ---
  const hasTranscript = frames.some((f) => f.transcript);
  const lines = [];
  lines.push(`# ${job.title || path.basename(String(job.source))}`);
  lines.push('');
  const metaBits = [
    `**Source:** ${job.source}`,
    job.duration ? `**Duration:** ${fmtLabel(job.duration)}` : null,
    win ? `**Window:** ${win.label}` : null,
    `**Frames:** ${frames.length} (${job.method})`,
    json.resolution ? `**Source res:** ${json.resolution}` : null,
    job.contactSheet ? `**Contact sheet:** \`${job.contactSheet}\`` : null,
    `**Generated:** ${generatedAt.toISOString().slice(0, 10)}`,
  ].filter(Boolean);
  lines.push(metaBits.join('  ·  '));
  lines.push('');
  lines.push(
    'These frames were extracted from the video above to give visual context. ' +
      'Each filename encodes its index and its timestamp (`HH-MM-SS`) in the source.'
  );
  lines.push('');

  if (hasTranscript) {
    lines.push('| # | Timestamp | Frame | Transcript near this moment |');
    lines.push('|---|-----------|-------|------------------------------|');
    for (const f of frames) {
      const t = (f.transcript || '').replace(/\|/g, '\\|').replace(/\n+/g, ' ').trim();
      lines.push(`| ${f.index} | ${fmtLabel(f.tSec)} | \`frames/${f.file}\` | ${t} |`);
    }
  } else {
    lines.push('| # | Timestamp | Frame |');
    lines.push('|---|-----------|-------|');
    for (const f of frames) {
      lines.push(`| ${f.index} | ${fmtLabel(f.tSec)} | \`frames/${f.file}\` |`);
    }
  }
  lines.push('');

  await fs.writeFile(path.join(pkgDir, 'manifest.md'), lines.join('\n'), 'utf8');

  return json;
}

/** Normalize an optional { start, end } window into { start, end, label } or null. */
function windowOf(window) {
  if (!window) return null;
  const start = Math.max(0, Number(window.start) || 0);
  const end = window.end != null ? Number(window.end) : null;
  if (!start && end == null) return null; // full video — not a window
  return {
    start,
    end,
    label: `${fmtLabel(start)}–${end != null ? fmtLabel(end) : 'end'}`,
  };
}

/** Write a full timestamped transcript file when subtitle cues are available. */
export async function writeTranscript(pkgDir, cues) {
  if (!cues || !cues.length) return null;
  const lines = ['# Transcript', ''];
  for (const c of cues) {
    lines.push(`**[${fmtLabel(c.start)}]** ${c.text}`);
  }
  const p = path.join(pkgDir, 'transcript.md');
  await fs.writeFile(p, lines.join('\n'), 'utf8');
  return 'transcript.md';
}
