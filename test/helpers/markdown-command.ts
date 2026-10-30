const escapeRegExp = (t: string) => t.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

/** First single line of the markdown (fenced or inline code) that starts with `prefix` and contains `needle`; multi-line commands are not supported. */
export function commandFrom(md: string, prefix: string, needle: string): string {
  const re = new RegExp('^`?(' + escapeRegExp(prefix) + ' .*' + escapeRegExp(needle) + '[^`]*)`?$');
  for (const line of md.split('\n')) {
    const m = re.exec(line.trim());
    if (m) return m[1];
  }
  throw new Error(`command not found in markdown: ${prefix} ... ${needle}`);
}
