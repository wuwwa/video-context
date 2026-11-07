---
name: arc-ui
description: "Build and refine React interfaces using Arc UI's free components, semantic tokens, and restrained motion."
metadata:
  created: "2026-11-07"
  updated: "2026-11-07"
  review-after: "2027-02-05"
  status: "draft"
---

# Arc UI

Read [setup and component notes](references/setup.md) before integration. This is Collection's short adapter to the upstream Arc skill.

- Use existing Arc components for controls and overlays. Follow their documented props; use free items unless Pro access is provided.
- Import foundation once. Use semantic tokens, Inter for controls, and Geist for display headings; keep body copy short.
- Use one clear primary action per surface. Preserve the project's identity and the user's design preferences.
- Use motion to explain interaction; support keyboard operation and reduced motion.
- Check the actual screen on mobile and desktop, then run the project's checks.

Source: [official Arc skill](https://uiarc.dev/r/skills/arc/SKILL.md) and [installation guide](https://uiarc.dev/docs/installation), reviewed 2026-11-07. Local notes preserve the decisions already checked in Collection. Consult current upstream docs for a new component or changed tooling.

