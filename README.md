# video-context

Turn a video (local file or URL) into a set of timestamped frames plus a manifest you can hand to Claude.

Runs locally: a small Express server drives `ffmpeg` (frames) and `yt-dlp` (URL downloads + subtitles). Open one page, pick a source, click Extract.

## Requirements

- Node.js 18+
- `ffmpeg` and `ffprobe` on your PATH (Windows: `winget install Gyan.FFmpeg`)
- `yt-dlp` — only for URLs; local files work without it (`pip install -U yt-dlp` or `winget install yt-dlp`)

If a tool isn't on your PATH, set it in `.env` (see `.env.example`).

## Run

```bash
npm install
npm start
```

Open http://localhost:5173. (`npm run dev` restarts on changes.)

## Usage

1. Choose a source: paste a URL, or paste the full path to a local file (drop a file to preview/scrub it).
2. Pick how frames are chosen:
   - **Scene** — detects shot changes (up to a frame budget).
   - **Interval** — one frame every N seconds.
   - **Manual** — type or capture timestamps.
3. Optionally set a **clip window** (start/end) to limit frames to one section. For URLs, only that section is downloaded.
4. Extract, review the grid, untick frames you don't want, then **Save All (.zip)**.

## Output

Each job writes `output/<slug>__<id>/`:

```
frames/                 one image per frame, named <slug>__<index>__<HH-MM-SS>
contactsheet.jpg        all frames in one labeled grid
manifest.md / .json     frame list with timestamps (+ transcript snippets)
transcript.md           full transcript, when subtitles are available
```

Frames are downscaled to a 1568px long edge; URL downloads are capped at 720p.

## Config (`.env`)

| Var | Default | Meaning |
|-----|---------|---------|
| `PORT` | `5173` | server port |
| `FFMPEG_PATH` / `FFPROBE_PATH` / `YTDLP_PATH` | auto | explicit tool paths |
| `OUTPUT_DIR` | `output` | where packages are written |
| `MAX_FRAMES` | `60` | cap on frames per job |
| `FRAME_LONG_EDGE` | `1568` | frame long-edge size |
| `SHEET_FONT` | `Arial` | font family for contact-sheet labels |

[`framegrab.html`](framegrab.html) is an offline, single-file fallback for local files only (no server, no yt-dlp).
