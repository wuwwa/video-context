Framegrab 2.1 — 2026-11-07

Interval capture is now the main workflow. Default: every two seconds across the whole video. The slider changes the interval, the button shows the resulting count, and Range exposes start/end fields. Timeline scrubbing and individual capture remain available. Downloads default to high (1080p), with lower and best-available choices.

Captures default to source-resolution PNG instead of resized JPEG. AI reference export is the default: native captures, four-frame image pages, full transcript and manifest. The old unbounded 400px-tile contact sheet is replaced. A 300-frame export creates 75 pages, keeping tile detail independent of the number of captures. Larger caption text is repeated below each tile. Tray previews use small, lazy-loaded thumbnails; exports always use the originals. The per-operation cap is raised to 10,000 frames.

The production build and eleven real integration checks passed. A 301-frame regression exported 76 pages, kept the first page byte-identical to a four-frame export and preserved native PNGs byte-for-byte. GUI checks covered interval-slider behavior, range timestamps 1/3/5/7, whole-video sampling, native PNG capture with available captions, default high download quality/embedding, reference export with actual folder, and no horizontal overflow at 960/760/390px.
