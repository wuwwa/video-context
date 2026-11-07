# Arc UI

Free components installed from the [official Arc registry](https://uiarc.dev/docs/installation) on 2026-11-07:
button, search-field, segmented-control, dialog, select, empty-state, textarea, accordion, foundation and motion tokens.

Source is kept in `app/src/components/arc/`. See [Arc licensing](https://uiarc.dev/license).
Local accessibility fixes: the dialog close button and touch selection targets are at least 44px.
The accordion adds controlled `value`/`onValueChange` props for copy fallback and makes collapsed panels inert. Its motion and styles come from the [official registry](https://uiarc.dev/r/accordion.json), checked 2026-11-07.
The catalog's external projects retain their original source and demo links in `catalog.json`.

# Bundled upstream skills

- `skills/security-audit/`: Cloudflare's MIT-licensed skill at `c1c8a8c1471069fb0e188eeaff69b8e8db6564a8`.
- `skills/ascii-art/`: 0xSero's MIT-licensed skill and engine at `0968699a97e1807b54e7b7db2603c351490adaed`.

Their licenses and local provenance notes ship in the skill folders and downloadable bundles. Local changes only add collection dates/metadata; ASCII's version field is retained inside metadata.

