// Scene detection: one analysis pass with ffmpeg's scene filter, parse the
// scores from showinfo, then pick budgeted, gap-spaced timestamps.

import { run, requireFfmpeg } from './tools.js';

/**
 * Run a scene-analysis pass. Returns [{ tSec, score }] for detected scene changes.
 * threshold ~0.3 is a typical default; lower = more candidates.
 *
 * Optional { ss, dur } limit the analysis to a window (input-seek + duration) so we
 * only scan the slice the caller cares about. NOTE: with input-seek the returned
 * pts_time is window-relative — the caller must add `ss` back to get absolute time.
 */
export async function detectScenes(videoPath, threshold = 0.3, { ss, dur } = {}) {
  const ffmpeg = await requireFfmpeg();
  // metadata=print dumps pts_time + scene score lines to stderr/stdout.
  const args = ['-y'];
  if (ss != null && ss > 0) args.push('-ss', String(ss));
  if (dur != null && dur > 0) args.push('-t', String(dur));
  args.push(
    '-i', videoPath,
    '-filter:v', `select='gt(scene,${threshold})',metadata=print`,
    '-an', '-f', 'null', '-',
  );
  const res = await run(ffmpeg, args, { timeoutMs: 10 * 60 * 1000 });
  // ffmpeg prints metadata to stderr; don't require ok (it returns 0 normally).
  const text = `${res.stdout}\n${res.stderr}`;

  // Lines look like:
  //   frame:0    pts:12345   pts_time:5.12
  //   lavfi.scene_score=0.412345
  const scenes = [];
  let pendingTime = null;
  for (const line of text.split('\n')) {
    const tm = line.match(/pts_time:([0-9.]+)/);
    if (tm) { pendingTime = parseFloat(tm[1]); continue; }
    const sm = line.match(/lavfi\.scene_score=([0-9.]+)/);
    if (sm && pendingTime != null) {
      scenes.push({ tSec: pendingTime, score: parseFloat(sm[1]) });
      pendingTime = null;
    }
  }
  return scenes;
}

/**
 * Pick up to `budget` timestamps from scene candidates, enforcing a minimum gap.
 * Strategy: greedily take highest-scoring scenes, skipping any within minGap of
 * an already-chosen time. Always include the window's opening frame if room.
 * If too few scenes are found, fall back to even spacing across the window.
 *
 * `start`/`end` define the window in absolute source time; `duration` is the
 * fallback end when `end` is omitted. Candidate `scenes` are assumed absolute.
 */
export function selectScenes(scenes, { budget = 15, start = 0, end = 0, duration = 0, minGap = 2 } = {}) {
  const winStart = Math.max(0, start || 0);
  const winEnd = end || duration || 0;
  const span = winEnd - winStart;
  const chosen = [];

  // Seed with the opening frame of the window for context.
  if (span > 0) chosen.push({ tSec: winStart, score: null });

  const ranked = [...scenes].sort((a, b) => b.score - a.score);
  for (const s of ranked) {
    if (chosen.length >= budget) break;
    if (chosen.some((c) => Math.abs(c.tSec - s.tSec) < minGap)) continue;
    chosen.push(s);
  }

  // Fallback: not enough scene changes -> fill with even spacing across the window.
  if (chosen.length < Math.min(budget, 4) && span > 1) {
    const need = Math.min(budget, Math.max(4, chosen.length));
    for (let i = 0; i < need; i++) {
      const t = Math.round(winStart + (span * (i + 0.5)) / need);
      if (!chosen.some((c) => Math.abs(c.tSec - t) < minGap)) chosen.push({ tSec: t, score: null });
    }
  }

  return chosen
    .sort((a, b) => a.tSec - b.tSec)
    .slice(0, budget);
}
