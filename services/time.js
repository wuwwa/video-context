// Time helpers — ported from framegrab.html so client and server agree exactly.

/** Parse "39:12", "1:02:14", "39:12.5", or raw seconds -> seconds (number), or null. */
export function parseTime(s) {
  s = (s ?? '').toString().trim();
  if (!s) return null;
  if (/^\d+(\.\d+)?$/.test(s)) return parseFloat(s); // raw seconds
  const parts = s.split(':').map((p) => p.trim());
  if (parts.some((p) => p === '' || isNaN(Number(p)))) return null;
  let sec = 0;
  for (const p of parts) sec = sec * 60 + parseFloat(p);
  return sec;
}

/** Seconds -> human label "39:12" or "1:02:14" (hours only when present). */
export function fmtLabel(t) {
  t = Math.max(0, Math.floor(t));
  const h = Math.floor(t / 3600);
  const m = Math.floor((t % 3600) / 60);
  const s = t % 60;
  const mm = String(m).padStart(2, '0');
  const ss = String(s).padStart(2, '0');
  return h > 0 ? `${h}:${mm}:${ss}` : `${mm}:${ss}`;
}

/** Seconds -> filename-safe stamp "HH-MM-SS" (always zero-padded hours). */
export function fmtFile(t) {
  t = Math.max(0, Math.floor(t));
  const h = Math.floor(t / 3600);
  const m = Math.floor((t % 3600) / 60);
  const s = t % 60;
  return `${String(h).padStart(2, '0')}-${String(m).padStart(2, '0')}-${String(s).padStart(2, '0')}`;
}

/** Seconds -> ffmpeg/ffprobe timestamp "HH:MM:SS.mmm". */
export function fmtFfmpeg(t) {
  t = Math.max(0, t);
  const h = Math.floor(t / 3600);
  const m = Math.floor((t % 3600) / 60);
  const s = t - h * 3600 - m * 60;
  const ss = s.toFixed(3).padStart(6, '0'); // "07.500"
  return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}:${ss}`;
}
