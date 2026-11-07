# Framegrab

Turn a video into captioned screenshots for ChatGPT, Codex, or another AI.

**[Download for Windows](https://github.com/wuwwa/video-context/releases/latest/download/Framegrab.exe)** · [Portable ZIP with agent CLI](https://github.com/wuwwa/video-context/releases/latest/download/Framegrab-Windows.zip) · [Releases](https://github.com/wuwwa/video-context/releases)

1. Open **Framegrab.exe**. Choose **Download** and paste a video URL, or **Open video** for a local file.
2. Set **Every N sec**. Keep **Whole video**, or choose **Range** and enter start/end times.
3. Choose **Sample frames**, then **Save**. Use **Open folder** to find the result.

Defaults: high (up to 1080p), embedded English subtitles including automatic captions, one screenshot every two seconds, original-resolution PNGs. Lower download qualities are available. You can also scrub the timeline, type a timestamp, and use **Capture** for an individual frame.

## Output for AI reference

The default reference pack contains:

- **pages/** — numbered image pages, at most four frames each, with timestamps and caption text.
- **frames/** — the original exported captures.
- **transcript.txt / transcript.json / VTT** — all available timed dialogue, including between captures.
- **manifest.json** — each frame's source, requested/decoded timestamp, caption, crop, image dimensions and page/cell.

A 300-frame export creates **75 pages**. More screenshots add pages without squeezing the existing frames into smaller tiles.

For ChatGPT, attach pages and transcript in batches accepted by your plan. For Codex, point it at the exported folder so it can read the manifest and inspect images as needed. Sampled frames do not preserve every moment or sound.

## Agent commands

Keep `framegrab-cli.exe` beside `Framegrab.exe`; both are in the portable ZIP.

```powershell
.\framegrab-cli.exe download "VIDEO_URL" --out "C:\Videos"
.\framegrab-cli.exe frames "C:\Videos\video.mp4" --every 2 --out "C:\References"
.\framegrab-cli.exe frames "C:\Videos\video.mp4" --every 1 --start 01:00 --end 02:00 --out "C:\References"
.\framegrab-cli.exe transcript "C:\Videos\video.mp4" --query "search phrase"
```

Commands emit JSON with the actual created paths. See [Agent guide](desktop/AGENT_GUIDE.md).

## Source and requirements

The desktop application lives in [desktop/](desktop/README.md). FFmpeg, FFprobe, yt-dlp, Python and Node are bundled in the Windows download. Microsoft Edge WebView2 is required and is normally present on Windows 10/11. The executable is unsigned.

Text subtitles are supported; bitmap subtitles need OCR, which is not included. Source-site verification and rate limits can block downloads. Unexported captures are temporary until saved. The app does not upload videos or frames.

[Build instructions](desktop/README.md#rebuild) · [Verification](desktop/VERIFICATION.md) · [Third-party licenses](desktop/THIRD_PARTY.md)

The earlier Node/Express browser utility and offline `framegrab.html` remain available. See [browser version instructions](docs/browser-version.md). Run those commands from the repository root.
