# Sources and attribution

Design guidance was explicitly requested from https://github.com/wuwwa/wuwwa-skills . Applied: `skills/ui-design-polish/SKILL.md`, `skills/ui-motion/SKILL.md` and its implementation notes, `skills/coding-principles/SKILL.md`, and `skills/arc-ui/SKILL.md` and setup notes. Retrieved 2026-11-07, commit fd0c7ceb0ec712e6c7cd13276c1130dd51d5729f. The draft status of those preferences is retained; no comparative model performance is claimed.

Arc UI free components: button, dialog, select, segmented-control, foundation and motion tokens. The files under `ui/src/components/arc/` are preserved from the user's repository. Upstream: https://github.com/kuratlielia/arc-library and https://uiarc.dev/ . Free components are MIT, copyright 2026 Elia Kuratli. Full license: `licenses/Arc-UI-LICENSE.txt`. Product-specific styling lives separately in `ui/src/style.css`; no Pro components are used.

Runtime components:

- pywebview 6.2.1, https://github.com/r0x0r/pywebview (BSD-3-Clause)
- yt-dlp 2026.10.26, https://github.com/yt-dlp/yt-dlp (Unlicense; see its third-party notices)
- yt-dlp-ejs 0.8.0, https://github.com/yt-dlp/ejs (retained upstream license)
- Pillow 12.1.1, https://python-pillow.github.io/ (HPND; retained license)
- Python 3.12.7, https://www.python.org/ (PSF license)
- FFmpeg/FFprobe 7.1.1 essentials build, https://www.gyan.dev/ffmpeg/builds/ (GPL-3.0-or-later configuration). Upstream FFmpeg source: https://github.com/FFmpeg/FFmpeg/tree/n7.1.1 . Build configuration and source links ship in `licenses/FFmpeg-SOURCE.txt`; full license is included. No FFmpeg executable is modified.
- Node.js 25.8.2, https://nodejs.org/ , https://github.com/nodejs/node/tree/v25.8.2 (MIT and bundled third-party licenses). It runs yt-dlp's bundled JavaScript challenge solver; it is not exposed as an application command.
- React, Radix UI, Motion, Lucide and IBM Plex Sans are bundled locally. Their exact versions are locked in `ui/package-lock.json`; their upstream licenses are retained under `licenses/`.

The portable build includes copies of available upstream license and attribution files. The build scripts and authored application source are included in the source archive. The complete live-test video is not redistributed. The UI preview may show a still from the public test clip.

Typography revision: IBM Plex Sans is bundled under the SIL Open Font License 1.1. Its full license is in licenses/IBM-Plex-Sans-OFL.txt. This replaces the earlier Inter/Geist choice at the user's request.
