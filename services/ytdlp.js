// yt-dlp: fetch metadata, download a capped-resolution stream, grab auto-subs.

import path from 'node:path';
import { promises as fs } from 'node:fs';
import { run, requireYtdlp } from './tools.js';

/** Fetch metadata (title, duration) for a URL without downloading. */
export async function fetchMeta(url) {
  const ytdlp = await requireYtdlp();
  const res = await run(ytdlp, ['--dump-single-json', '--no-warnings', '--', url], { timeoutMs: 60000 });
  if (!res.ok) throw new Error(`yt-dlp metadata failed: ${tail(res.stderr)}`);
  let j;
  try { j = JSON.parse(res.stdout); } catch { throw new Error('yt-dlp returned invalid JSON'); }
  return { title: j.title || null, duration: j.duration || 0, id: j.id || null, ext: j.ext || null };
}

/**
 * Download the video (capped at <=720p) into destDir. Optionally only a window
 * [start, end] in source seconds (downloads just that section — big efficiency win)
 * and optionally auto-subs (vtt) when wantSubs is set.
 * Returns { videoPath, subPath|null, requestedStart } where requestedStart is the
 * window start that was asked for (null if the whole video was fetched).
 * onProgress(line) is called with raw yt-dlp stderr lines for UI streaming.
 */
export async function download(url, destDir, { maxHeight = 720, start = null, end = null, wantSubs = true, onProgress } = {}) {
  const ytdlp = await requireYtdlp();
  await fs.mkdir(destDir, { recursive: true });
  const outTmpl = path.join(destDir, 'source.%(ext)s');

  const section = sectionArg(start, end);

  // 1) Download the video only. This is the critical step — it must succeed.
  const args = [
    '-f', `bestvideo[height<=${maxHeight}]+bestaudio/best[height<=${maxHeight}]/best`,
    '--merge-output-format', 'mp4',
    '--no-playlist',
    '--no-warnings',
    '--concurrent-fragments', '4', // parallel fragment download (DASH/HLS)
    '--newline',                   // progress on its own line (no \r-only updates)
  ];
  if (section) {
    // Download ONLY the requested window. Stream-copied (cut at the nearest keyframe ≤
    // start) — near-instant, no re-encode. We deliberately do NOT pass
    // --force-keyframes-at-cuts: it re-encodes the whole section (minutes for a long
    // clip). The clip's internal time may reset to 0; the caller derives the offset by
    // probing the result. Frames land within ~one keyframe interval of their label.
    args.push('--download-sections', section);
  }
  args.push('-o', outTmpl, '--', url);
  const res = await run(ytdlp, args, { timeoutMs: 30 * 60 * 1000, onStderr: onProgress });
  if (!res.ok) throw new Error(`yt-dlp download failed: ${tail(res.stderr)}`);

  const filesAfterVideo = await fs.readdir(destDir);
  const video = filesAfterVideo.find((f) => /^source\.(mp4|mkv|webm|m4a|mov)$/i.test(f));
  if (!video) throw new Error('yt-dlp finished but no video file was found');

  // 2) Subtitles are OPTIONAL and opt-in — a failure here (e.g. HTTP 429, no captions)
  //    must NOT fail the job. Best-effort, separate, swallowed.
  let subPath = null;
  if (wantSubs) {
    try {
      const subRes = await run(
        ytdlp,
        [
          '--skip-download',
          '--write-auto-subs', '--write-subs',
          '--sub-langs', 'en.*,en',
          '--sub-format', 'vtt',
          '--no-playlist', '--no-warnings',
          '-o', outTmpl,
          '--', url,
        ],
        { timeoutMs: 5 * 60 * 1000 }
      );
      if (onProgress && !subRes.ok) onProgress('[subs] unavailable (continuing without transcript)\n');
    } catch {
      /* ignore — transcript is a bonus */
    }
    const files = await fs.readdir(destDir);
    const sub = files.find((f) => /^source\..*\.vtt$/i.test(f)) || files.find((f) => /\.vtt$/i.test(f));
    if (sub) subPath = path.join(destDir, sub);
  }

  return {
    videoPath: path.join(destDir, video),
    subPath,
    requestedStart: section ? Math.max(0, start || 0) : null,
  };
}

/** Build a yt-dlp --download-sections value "*START-END" (seconds), or null if no window. */
function sectionArg(start, end) {
  const s = start != null && start > 0 ? start : 0;
  const e = end != null && end > 0 ? end : null;
  if (!s && e == null) return null; // whole video
  return `*${s}-${e == null ? 'inf' : e}`;
}

function tail(s) {
  return (s || '').trim().split('\n').slice(-2).join(' ');
}
