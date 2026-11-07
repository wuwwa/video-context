---
name: coding-principles
description: "Keep implementation and refactoring simple, explicit, and easy to maintain. Use when making coding tradeoffs."
metadata:
  created: "2026-11-07"
  updated: "2026-11-07"
  review-after: "2027-02-05"
  status: "draft"
---

# Coding Principles

Use these as decision cues within the requested change:

- Build for requirements that exist. Defer speculative features and configuration.
- Start with the obvious solution. Optimize after evidence identifies a bottleneck.
- Let repeated code reveal the abstraction. Extract a pattern when the shared behavior is clear, rather than guessing it up front.
- Surface actionable errors. Avoid silently swallowing failures; retain appropriate recovery paths.
- Remove obsolete code when its callers and behavior have been checked. Fewer lines alone do not justify unrelated deletion.
- Choose names that explain purpose, units, and state. Prefer clarity over abbreviations; do not pad already clear names.

Preserve the project's conventions and behavior. Check the changed path with its relevant tests.

Source: user-supplied [screenshot](assets/source.png), credited in the image to `@Claude_Memory` on X. Original post URL and publication date are unknown. The six points are adapted and scoped here; this is a draft preference, not a measured claim about model performance.

