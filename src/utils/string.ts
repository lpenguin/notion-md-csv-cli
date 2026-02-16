/**
 * Unescape string sequences like \n, \t, \r from command line arguments.
 */
export function unescapeString(str: string): string {
  return str
    .replace(/\\n/g, '\n')
    .replace(/\\t/g, '\t')
    .replace(/\\r/g, '\r')
    .replace(/\\"/g, '"')
    .replace(/\\\\/g, '\\');
}

/**
 * Remove the common leading whitespace from every line in a string.
 *
 * Blank lines are ignored when calculating the common indent.
 * Useful when nested Notion blocks produce indented markdown that
 * must be fed back to a Markdown→Notion converter without the
 * cosmetic indentation being misinterpreted as a code block.
 */
export function dedentMarkdown(text: string): string {
  const lines = text.split('\n');
  const nonEmptyLines = lines.filter((l) => l.trim().length > 0);

  if (nonEmptyLines.length === 0) {
    return text;
  }

  const minIndent = Math.min(
    ...nonEmptyLines.map((l) => {
      const match = /^(\s*)/.exec(l);
      return match?.[1]?.length ?? 0;
    }),
  );

  if (minIndent === 0) {
    return text;
  }

  return lines
    .map((l) => (l.trim().length === 0 ? l : l.slice(minIndent)))
    .join('\n');
}
