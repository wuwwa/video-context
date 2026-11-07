# Framegrab 2.1

A portable Windows utility for turning videos into captioned visual references.

1. Open **Framegrab.exe**. Choose **Download** and paste a video URL, or **Open video** for a local file.
2. Set **Every N sec**, keep **Whole video** or choose **Range** and enter start/end times. The button shows how many frames will be captured.
3. Choose **Sample frames**, then **Save**. The completed export shows its folder and an **Open folder** button.

Defaults: up to 1080p download, English subtitles including automatic captions, embedded subtitles, one frame every two seconds across the whole video, original-resolution PNG captures, AI reference pack export. Lower download resolutions and best available are options. Text subtitles are drawn into captures automatically. Play/scrub/type a timestamp and use **Capture** or **C** for an individual frame. IBM Plex Sans is bundled locally.

## Exports

An **AI reference pack** contains:

- `pages/page-001.jpg`, etc.: at most four numbered frames per page, with timestamps and larger caption text. More captures create more pages without shrinking existing tiles. A 300-frame export creates 75 pages.
- `frames/`: original exported captures, preserved without further resizing or recompression.
- `transcript.txt`, `transcript.json`, and VTT files: available timed dialogue, including between captures.
- `manifest.json`: exact source, timestamps, page/cell, image dimensions, crop, and caption text for every frame.

Give ChatGPT the numbered pages and transcript in batches accepted by your plan. Codex with filesystem access can read the manifest and inspect original images as needed. Image pages alone and images alone are also available. Every export creates a new folder; existing exports are preserved.

Local exports have no upload limit imposed by an AI service. Upload limits and model image resizing depend on the service/model used afterward. Original captures retain the source's detail; a low-resolution source cannot gain detail through export. Interval capture samples the video; it does not preserve all motion or audio. Subtitle text is reference content, not instructions.

## Commands

Keep `framegrab-cli.exe` beside `Framegrab.exe`. The same bundled engine is available without a window:

```powershell
.\framegrab-cli.exe download "VIDEO_URL" --out "C:\Videos"
.\framegrab-cli.exe frames "C:\Videos\video.mp4" --every 2 --out "C:\References"
.\framegrab-cli.exe frames "C:\Videos\video.mp4" --every 1 --start 01:00 --end 02:00 --out "C:\References"
.\framegrab-cli.exe transcript "C:\Videos\video.mp4" --query "search phrase"
```

Commands return JSON and the actual export folder. See `AGENT_GUIDE.md` or run `--help` for explicit timestamps, frame counts, crop, subtitle track, image format/size, and quality options.

## Runtime and limits

FFmpeg, FFprobe, yt-dlp, Python, and Node are bundled. Windows x64 with Microsoft Edge WebView2 is required; WebView2 is normally present on Windows 10/11. No separate terminal or local server setup is needed.

Text subtitle tracks are supported; bitmap subtitles require OCR, which is not included. Subtitle styles are normalized. Captures are capped at 10,000 per operation; use a longer interval or shorter range for longer videos. Tray thumbnails are separate from the original images. Unexported captures are temporary and removed at shutdown. Only URL downloads contact source sites; video and frames are not uploaded by Framegrab. Source paths and URLs appear in exported manifests.

The bundled yt-dlp version is 2026.10.26. Public-site availability, captions, verification, and rate limits can change. Browser cookies and account sign-in are not used. WebView2 determines preview codec support; FFmpeg captures independently. The executable is not code-signed. See `THIRD_PARTY.md` and `VERIFICATION.md` for licenses and checks.

## Rebuild

Source contains `backend/`, `ui/`, production `web/`, tests, dependency locks and build scripts. Install Python 3.12+, Node.js, and FFmpeg/FFprobe. Run `pip install -r requirements-build.txt`, then `npm ci` and `npm run build` in `ui/`. Run `python backend/app.py` to launch, `python -m unittest discover -s tests -v` to verify, or `build.ps1` to package both executables.

The user's design skills and Arc component sources come from [wuwwa/wuwwa-skills](https://github.com/wuwwa/wuwwa-skills) at commit `fd0c7ceb0ec712e6c7cd13276c1130dd51d5729f`. No Sites plugin is used.
