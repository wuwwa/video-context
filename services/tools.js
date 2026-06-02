// Resolve and probe external tools: ffmpeg, ffprobe, yt-dlp.
//
// Resolution order for each tool:
//   1. Explicit env override (FFMPEG_PATH / FFPROBE_PATH / YTDLP_PATH)
//   2. Bare command name on PATH (spawn will find it)
//   3. Known fallback locations (best-effort, platform-specific)
//
// yt-dlp is OPTIONAL: the whole local-file path works without it. We detect it
// honestly so the UI can show a banner + install hint instead of failing silently.

import { spawn } from 'node:child_process';
import { existsSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const isWin = process.platform === 'win32';

// Best-effort fallback locations when a tool isn't on PATH.
function fallbackCandidates(tool) {
  const home = os.homedir();
  const list = [];
  if (tool === 'ffmpeg' || tool === 'ffprobe') {
    if (isWin) {
      // WinGet Gyan.FFmpeg.Essentials (confirmed present on this machine).
      list.push(
        path.join(
          home,
          'AppData/Local/Microsoft/WinGet/Packages',
          'Gyan.FFmpeg.Essentials_Microsoft.Winget.Source_8wekyb3d8bbwe',
          'ffmpeg-7.1.1-essentials_build/bin',
          `${tool}.exe`
        )
      );
    }
  }
  if (tool === 'yt-dlp') {
    if (isWin) {
      list.push(
        path.join(home, 'AppData/Local/Microsoft/WinGet/Links/yt-dlp.exe'),
        path.join(home, 'AppData/Roaming/Python/Python312/Scripts/yt-dlp.exe'),
        path.join(home, 'scoop/shims/yt-dlp.exe'),
        'C:/Program Files/yt-dlp/yt-dlp.exe'
      );
    } else {
      list.push('/usr/local/bin/yt-dlp', '/usr/bin/yt-dlp', path.join(home, '.local/bin/yt-dlp'));
    }
  }
  return list.filter((p) => existsSync(p));
}

function envOverride(tool) {
  const map = { ffmpeg: 'FFMPEG_PATH', ffprobe: 'FFPROBE_PATH', 'yt-dlp': 'YTDLP_PATH' };
  const v = process.env[map[tool]];
  return v && v.trim() ? v.trim() : null;
}

/** Run `<cmd> <args>` and capture stdout/stderr. Never throws; resolves a result object. */
export function run(cmd, args, { cwd, timeoutMs = 0, onStderr } = {}) {
  return new Promise((resolve) => {
    let child;
    try {
      child = spawn(cmd, args, { cwd, windowsHide: true });
    } catch (err) {
      resolve({ ok: false, code: null, stdout: '', stderr: String(err?.message || err), spawnError: true });
      return;
    }
    let stdout = '';
    let stderr = '';
    let timer = null;
    if (timeoutMs > 0) {
      timer = setTimeout(() => {
        try { child.kill('SIGKILL'); } catch { /* ignore */ }
      }, timeoutMs);
    }
    child.stdout.on('data', (d) => { stdout += d.toString(); });
    child.stderr.on('data', (d) => {
      const s = d.toString();
      stderr += s;
      if (onStderr) onStderr(s);
    });
    child.on('error', (err) => {
      if (timer) clearTimeout(timer);
      resolve({ ok: false, code: null, stdout, stderr: stderr || String(err?.message || err), spawnError: true });
    });
    child.on('close', (code) => {
      if (timer) clearTimeout(timer);
      resolve({ ok: code === 0, code, stdout, stderr });
    });
  });
}

// First word of a version banner / `--version` line.
function firstLine(s) {
  return (s || '').split('\n')[0].trim();
}

async function detect(tool, versionArgs) {
  const override = envOverride(tool);
  const candidates = [override, tool, ...fallbackCandidates(tool)].filter(Boolean);
  for (const cmd of candidates) {
    const res = await run(cmd, versionArgs, { timeoutMs: 8000 });
    if (res.ok || res.stdout || (!res.spawnError && res.stderr)) {
      // ffmpeg prints its banner to stderr; treat any successful spawn with output as found.
      if (res.spawnError) continue;
      const out = res.stdout.trim() || res.stderr.trim();
      if (!out) continue;
      return { found: true, path: cmd, version: firstLine(out) };
    }
  }
  return { found: false, path: null, version: null };
}

let cache = null;

/** Detect all tools (cached). Pass force=true to re-probe. */
export async function detectTools(force = false) {
  if (cache && !force) return cache;
  const [ffmpeg, ffprobe, ytdlp] = await Promise.all([
    detect('ffmpeg', ['-version']),
    detect('ffprobe', ['-version']),
    detect('yt-dlp', ['--version']),
  ]);
  cache = {
    ffmpeg,
    ffprobe,
    ytdlp,
    ready: ffmpeg.found && ffprobe.found, // minimum to do anything useful (local files)
    urlReady: ffmpeg.found && ffprobe.found && ytdlp.found,
  };
  return cache;
}

/** Convenience getters that throw a clear error if a required tool is missing. */
export async function requireFfmpeg() {
  const t = await detectTools();
  if (!t.ffmpeg.found) throw new Error('ffmpeg not found. Install it and/or set FFMPEG_PATH.');
  return t.ffmpeg.path;
}
export async function requireFfprobe() {
  const t = await detectTools();
  if (!t.ffprobe.found) throw new Error('ffprobe not found. Install it and/or set FFPROBE_PATH.');
  return t.ffprobe.path;
}
export async function requireYtdlp() {
  const t = await detectTools();
  if (!t.ytdlp.found) {
    throw new Error(
      'yt-dlp not found. Install it (pip install -U yt-dlp  OR  winget install yt-dlp) and/or set YTDLP_PATH. ' +
        'Local video files work without it.'
    );
  }
  return t.ytdlp.path;
}
