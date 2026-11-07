# Verification

Checked 2026-11-07 on Windows 11 x64, Python 3.12.7 and Microsoft Edge WebView2.

- Production TypeScript/Vite build passed.
- Eleven real integration tests passed: embedded English/Spanish text tracks, transcript search, captions rendered versus off, crop/resize, actual decoded timestamps/final frame, default every-two-second capture, selected range, reference/page/image export, invalid input/cancellation, token authorization, byte ranges, background jobs, separate preview thumbnails, and yt-dlp download with embedded WebVTT captions.
- A 301-frame export regression wrote 76 numbered pages. The first page was byte-identical to a four-frame export; native 1920 × 1080 PNGs were copied byte-for-byte. All page dimensions were below 2048 per side and page files below 20 MiB. This is an export scaling check, not a claim that every frame was decoded from a 301-second video.
- GUI: interval slider changed the planned count; a two-second interval over 00:01–00:07 captured requested times 1/3/5/7. Whole-video sampling captured ten frames from the 19-second test video. Reference export wrote four pages, fourteen original PNGs, transcript and manifest. The UI displayed the actual output folder.
- Layout checked at 1280, 960, 760 and 390 pixels; no horizontal document overflow. Source UI and packaged WebView2 had no console errors or warnings.
- Packaged desktop window: downloaded a controlled HTTP video through the URL dialog, embedded/displayed captions, sampled 0/2/4 seconds, typed 00:01 and captured with C, exported four native PNGs plus one page/transcript/manifest, and showed its folder with Open folder. Default download quality was high (1080p); source fixture was 640 × 360, so it was not upscaled.
- Packaged console companion: default sampling, selected range 1/2/3/4, schema 2 export, native PNG, paginated sheet, missing-file error/exit code, controlled HTTP download embedding and transcript extraction passed.
- Executable production web assets were compared byte-for-byte with the source build. IBM Plex Sans and the runtime tools are bundled. Portable/source archives and checksums are verified by the release script.
- Earlier live YouTube check: public video jNQXAC9IVRw downloaded and FFprobe confirmed embedded English mov_text captions. Repeated requests later triggered YouTube sign-in/verification in both source and packaged builds. Verification is surfaced as a failed download. The downloaded video is not redistributed.

No bitmap-subtitle OCR, source-style preservation, browser-account authentication, code signing or clean-second-machine certification. Preview codecs depend on WebView2. Native OS file/folder picker interactions were not automated. Unexported captures are temporary until Save.
