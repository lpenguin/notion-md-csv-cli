import { describe, it, expect } from 'vitest';
import { unescapeString, dedentMarkdown } from '../src/utils/string.js';

/* ================================================================== */
/*  unescapeString                                                     */
/* ================================================================== */

describe('unescapeString', () => {
  it('should unescape \\n to newline', () => {
    expect(unescapeString('hello\\nworld')).toBe('hello\nworld');
  });

  it('should unescape \\t to tab', () => {
    expect(unescapeString('col1\\tcol2')).toBe('col1\tcol2');
  });

  it('should unescape multiple sequences', () => {
    expect(unescapeString('a\\nb\\tc')).toBe('a\nb\tc');
  });
});

/* ================================================================== */
/*  dedentMarkdown                                                     */
/* ================================================================== */

describe('dedentMarkdown', () => {
  it('should strip uniform 4-space indent from all lines', () => {
    const input = '    - Item A\n    - Item B\n    - Item C';
    expect(dedentMarkdown(input)).toBe('- Item A\n- Item B\n- Item C');
  });

  it('should strip only the smallest common indent', () => {
    const input = '    - Parent\n        - Child';
    expect(dedentMarkdown(input)).toBe('- Parent\n    - Child');
  });

  it('should return the string unchanged when there is no common indent', () => {
    const input = '- Item A\n- Item B';
    expect(dedentMarkdown(input)).toBe('- Item A\n- Item B');
  });

  it('should ignore blank lines when computing common indent', () => {
    const input = '    - Item A\n\n    - Item B';
    expect(dedentMarkdown(input)).toBe('- Item A\n\n- Item B');
  });

  it('should handle a single indented line', () => {
    expect(dedentMarkdown('      hello')).toBe('hello');
  });

  it('should handle empty string', () => {
    expect(dedentMarkdown('')).toBe('');
  });

  it('should handle all-blank-line input', () => {
    expect(dedentMarkdown('   \n   ')).toBe('   \n   ');
  });

  it('should handle tab indentation', () => {
    const input = '\t- Item A\n\t- Item B';
    expect(dedentMarkdown(input)).toBe('- Item A\n- Item B');
  });

  it('should preserve relative indentation between nested items', () => {
    const input = [
      '    - _Зеленые лозы_ — скрывают **Луга (Meadow)**.',
      '    - _Сухой кустарник_ — скрывают **Пустыню (Desert)**.',
      '        - Sub-item under кустарник',
    ].join('\n');
    const expected = [
      '- _Зеленые лозы_ — скрывают **Луга (Meadow)**.',
      '- _Сухой кустарник_ — скрывают **Пустыню (Desert)**.',
      '    - Sub-item under кустарник',
    ].join('\n');
    expect(dedentMarkdown(input)).toBe(expected);
  });
});
