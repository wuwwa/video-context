---
name: ui-motion
description: "Polish UI animations: entrances, exits, feedback, dragging, and shared-element transitions."
metadata:
  created: "2026-11-07"
  updated: "2026-11-07"
  review-after: "2027-02-05"
  status: "draft"
---

# UI Motion

Use motion to explain what changed. Reuse the project's existing animation tools.
These are starting points to tune, not effects to add everywhere.

1. Ease out entrances.
2. Try 150-250 ms for dropdowns.
3. Stagger entering rows by about 30 ms; cap the total delay.
4. Try a 0.97 press scale without shrinking the hit area.
5. For playful knobs, try up to 12% directional stretch.
6. Bring secondary details in as the main surface settles.
7. Use arcs when they help explain an object's movement.
8. Use a brief pulse for success, alongside a clear final state.
9. Ease in and out when moving an already-visible object.
10. Try starting popovers at 0.95 scale.
11. Enter from the trigger.
12. Exit toward the trigger when it remains visible.
13. Keep routine UI free of obvious bounce.
14. Follow input directly while dragging; ease only after release.
15. Try exits about 20% shorter than entrances.
16. Briefly overlap state changes; only the current state accepts input.
17. Use masks for purposeful reveals without clipping focus indicators.
18. Crossfade changing icons; add blur only if it stays legible.
19. Use rubber-band resistance for bounded dragging; keep actual values valid.
20. Preserve shared-element identity. In Motion, match `layoutId` for the same object.

Respect reduced-motion preferences. Check keyboard focus, rapid reversals, text clarity, and input responsiveness.

For implementation, read the bundled [motion notes](references/implementation.md). Fetch the original manuals only when a specific API or version needs checking.

Source: supplied Charles Liu screenshot, `IMG_2596.PNG`. Original publication date unknown. Accessibility and input checks are added guidance.

References: [Motion layout](https://motion.dev/docs/react-layout-animations), [reduced motion](https://developer.mozilla.org/en-US/docs/Web/CSS/Reference/At-rules/@media/prefers-reduced-motion). Checked 2026-11-07.

