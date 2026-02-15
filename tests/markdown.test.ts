import { describe, it, expect } from 'vitest';
import {
  addLineNumbers,
  stripLineNumbers,
  extractTitle,
  cleanMarkdownOutput,
  fixChildPageBlocks,
} from '../src/lib/markdown.js';
import { type MdBlock } from 'notion-to-md/build/types/index.js';

/* ------------------------------------------------------------------ */
/*  Helper: build an MdBlock for testing                               */
/* ------------------------------------------------------------------ */
function makeMdBlock(
  overrides: Partial<MdBlock> & { type: string; parent: string },
): MdBlock {
  return {
    blockId: 'fake-block-id',
    children: [],
    ...overrides,
  };
}

/* ================================================================== */
/*  addLineNumbers / stripLineNumbers / extractTitle (existing tests)  */
/* ================================================================== */

describe('Markdown Utilities', () => {
  describe('addLineNumbers', () => {
    it('should add 1-based line numbers', () => {
      const input = 'line one\nline two\nline three';
      const result = addLineNumbers(input);
      expect(result).toBe('1: line one\n2: line two\n3: line three');
    });

    it('should pad line numbers for alignment', () => {
      const lines = Array.from({ length: 12 }, (_, i) => `line ${i + 1}`).join('\n');
      const result = addLineNumbers(lines);
      expect(result).toContain(' 1: line 1');
      expect(result).toContain('12: line 12');
    });
  });

  describe('stripLineNumbers', () => {
    it('should remove line number prefixes', () => {
      const input = '1: line one\n2: line two\n3: line three';
      const result = stripLineNumbers(input);
      expect(result).toBe('line one\nline two\nline three');
    });

    it('should handle padded line numbers', () => {
      const input = ' 1: line one\n10: line ten';
      const result = stripLineNumbers(input);
      expect(result).toBe('line one\nline ten');
    });
  });

  describe('extractTitle', () => {
    it('should extract H1 title', () => {
      const md = '# My Page Title\n\nSome content.';
      expect(extractTitle(md)).toBe('My Page Title');
    });

    it('should return "Untitled" when no H1 found', () => {
      const md = 'Just some text without a heading.';
      expect(extractTitle(md)).toBe('Untitled');
    });

    it('should extract the first H1 only', () => {
      const md = '# First Title\n\n# Second Title';
      expect(extractTitle(md)).toBe('First Title');
    });
  });
});

/* ================================================================== */
/*  cleanMarkdownOutput — trimming & newline collapsing                */
/* ================================================================== */

describe('cleanMarkdownOutput', () => {
  it('should trim leading and trailing whitespace', () => {
    expect(cleanMarkdownOutput('  hello  ')).toBe('hello');
  });

  it('should trim leading and trailing newlines', () => {
    expect(cleanMarkdownOutput('\n\nhello\n\n')).toBe('hello');
  });

  it('should collapse triple newlines to double', () => {
    expect(cleanMarkdownOutput('a\n\n\nb')).toBe('a\n\nb');
  });

  it('should collapse many consecutive newlines to exactly two', () => {
    expect(cleanMarkdownOutput('a\n\n\n\n\n\nb')).toBe('a\n\nb');
  });

  it('should preserve exactly two consecutive newlines', () => {
    expect(cleanMarkdownOutput('a\n\nb')).toBe('a\n\nb');
  });

  it('should preserve single newlines', () => {
    expect(cleanMarkdownOutput('a\nb')).toBe('a\nb');
  });

  it('should handle multiple groups of excessive newlines', () => {
    const input = 'a\n\n\n\nb\n\n\nc';
    expect(cleanMarkdownOutput(input)).toBe('a\n\nb\n\nc');
  });

  it('should return empty string for whitespace-only input', () => {
    expect(cleanMarkdownOutput('   \n\n  ')).toBe('');
  });

  it('should return empty string for empty input', () => {
    expect(cleanMarkdownOutput('')).toBe('');
  });
});

/* ================================================================== */
/*  fixChildPageBlocks — child_page → paragraph rewriting              */
/* ================================================================== */

describe('fixChildPageBlocks', () => {
  it('should convert a child_page block to paragraph', () => {
    const blocks: MdBlock[] = [
      makeMdBlock({ type: 'child_page', parent: '[[My Page]](https://notion.so/abc)' }),
    ];

    fixChildPageBlocks(blocks);

    expect(blocks[0]?.type).toBe('paragraph');
    expect(blocks[0]?.parent).toBe('[[My Page]](https://notion.so/abc)');
  });

  it('should not modify non-child_page blocks', () => {
    const blocks: MdBlock[] = [
      makeMdBlock({ type: 'heading_1', parent: '# Title' }),
      makeMdBlock({ type: 'paragraph', parent: 'Some text' }),
    ];

    fixChildPageBlocks(blocks);

    expect(blocks[0]?.type).toBe('heading_1');
    expect(blocks[1]?.type).toBe('paragraph');
  });

  it('should recursively fix child_page blocks in children', () => {
    const childBlock = makeMdBlock({
      type: 'child_page',
      parent: '[[Nested]](https://notion.so/nested)',
    });
    const parentBlock = makeMdBlock({
      type: 'toggle',
      parent: 'Toggle content',
      children: [childBlock],
    });
    const blocks: MdBlock[] = [parentBlock];

    fixChildPageBlocks(blocks);

    expect(parentBlock.type).toBe('toggle');
    expect(childBlock.type).toBe('paragraph');
  });

  it('should handle deeply nested child_page blocks', () => {
    const deep = makeMdBlock({ type: 'child_page', parent: '[[Deep]](url)' });
    const mid = makeMdBlock({ type: 'bulleted_list_item', parent: 'item', children: [deep] });
    const top = makeMdBlock({ type: 'paragraph', parent: 'top', children: [mid] });

    fixChildPageBlocks([top]);

    expect(deep.type).toBe('paragraph');
    expect(mid.type).toBe('bulleted_list_item');
    expect(top.type).toBe('paragraph');
  });

  it('should convert multiple child_page blocks in a flat list', () => {
    const blocks: MdBlock[] = [
      makeMdBlock({ type: 'child_page', parent: '[[A]](url-a)' }),
      makeMdBlock({ type: 'paragraph', parent: 'normal' }),
      makeMdBlock({ type: 'child_page', parent: '[[B]](url-b)' }),
    ];

    fixChildPageBlocks(blocks);

    expect(blocks[0]?.type).toBe('paragraph');
    expect(blocks[1]?.type).toBe('paragraph');
    expect(blocks[2]?.type).toBe('paragraph');
  });

  it('should preserve parent content after type rewrite', () => {
    const link = '[[Test Page]](https://www.notion.so/abc123)';
    const blocks: MdBlock[] = [
      makeMdBlock({ type: 'child_page', parent: link }),
    ];

    fixChildPageBlocks(blocks);

    expect(blocks[0]?.parent).toBe(link);
  });

  it('should handle empty block list without error', () => {
    const blocks: MdBlock[] = [];
    fixChildPageBlocks(blocks);
    expect(blocks).toHaveLength(0);
  });
});
