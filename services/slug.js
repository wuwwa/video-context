// Safe slugs for folder/file names from titles or filenames.

/** Turn an arbitrary title/filename into a filesystem-safe slug. */
export function slugify(input, maxLen = 50) {
  const base = (input ?? '')
    .toString()
    .normalize('NFKD')
    .replace(/[^\w\s.-]+/g, '') // drop anything not word/space/dot/dash
    .trim()
    .replace(/[\s.]+/g, '_') // spaces & dots -> underscore
    .replace(/_+/g, '_')
    .replace(/^[-_]+|[-_]+$/g, '')
    .slice(0, maxLen);
  return base || 'video';
}

/** Short random-ish id without Math.random (timestamp-derived, collision-resistant enough for local single-user). */
export function shortId(seed = Date.now()) {
  return Number(seed).toString(36).slice(-6) + Number(seed * 31 + 7).toString(36).slice(-2);
}
