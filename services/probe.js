// ffprobe metadata: duration, dimensions, fps.

import { run, requireFfprobe } from './tools.js';

/** Probe a media file. Returns { duration, startTime, width, height, fps, title }. Throws on failure. */
export async function probe(filePath) {
  const ffprobe = await requireFfprobe();
  const res = await run(
    ffprobe,
    [
      '-v', 'error',
      '-print_format', 'json',
      '-show_format',
      '-show_streams',
      filePath,
    ],
    { timeoutMs: 30000 }
  );
  if (!res.ok) {
    throw new Error(`ffprobe failed: ${res.stderr.trim() || 'unknown error'}`);
  }
  let data;
  try {
    data = JSON.parse(res.stdout);
  } catch {
    throw new Error('ffprobe returned invalid JSON');
  }
  const video = (data.streams || []).find((s) => s.codec_type === 'video');
  if (!video) throw new Error('No video stream found in file');

  const duration =
    parseFloat(data.format?.duration) ||
    parseFloat(video.duration) ||
    0;

  // fps from avg_frame_rate "30000/1001"
  let fps = 0;
  const fr = video.avg_frame_rate || video.r_frame_rate;
  if (fr && fr.includes('/')) {
    const [n, d] = fr.split('/').map(Number);
    if (d) fps = n / d;
  }

  return {
    duration,
    startTime: parseFloat(data.format?.start_time) || 0,
    width: video.width || 0,
    height: video.height || 0,
    fps: fps ? Math.round(fps * 100) / 100 : 0,
    title: data.format?.tags?.title || null,
  };
}
