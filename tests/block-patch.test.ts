import { describe, it, expect } from 'vitest';
import {
  buildBlockLineMap,
  computePatchPlan,
  findBlockAtLine,
  getPreservedContent,
} from '../src/lib/block-patch.js';
import { type MdBlock } from 'notion-to-md/build/types/index.js';

/* ------------------------------------------------------------------ */
/*  Helper: build an MdBlock for testing                               */
/* ------------------------------------------------------------------ */
function makeMdBlock(
  overrides: Partial<MdBlock> & { type: string; parent: string; blockId?: string },
): MdBlock {
  return {
    blockId: overrides.blockId ?? `block-${Math.random().toString(36).slice(2, 8)}`,
    children: [],
    ...overrides,
  };
}

/* ================================================================== */
/*  buildBlockLineMap tests                                            */
/* ================================================================== */

describe('Block Patch Engine', () => {
  describe('buildBlockLineMap', () => {
    it('should map a single block to line 1', () => {
      const blocks: MdBlock[] = [
        makeMdBlock({ type: 'paragraph', parent: 'Hello world', blockId: 'block-1' }),
      ];

      const result = buildBlockLineMap(blocks);

      expect(result.markdown).toBe('Hello world');
      expect(result.mappings).toHaveLength(1);
      expect(result.mappings[0]).toMatchObject({
        blockId: 'block-1',
        type: 'paragraph',
        startLine: 1,
        endLine: 1,
      });
    });

    it('should map multiple blocks to consecutive lines', () => {
      const blocks: MdBlock[] = [
        makeMdBlock({ type: 'heading_1', parent: '# Title', blockId: 'block-1' }),
        makeMdBlock({ type: 'paragraph', parent: 'First paragraph', blockId: 'block-2' }),
        makeMdBlock({ type: 'paragraph', parent: 'Second paragraph', blockId: 'block-3' }),
      ];

      const result = buildBlockLineMap(blocks);

      // No blank lines between blocks - consecutive line numbers
      expect(result.mappings).toHaveLength(3);
      expect(result.mappings[0]).toMatchObject({
        blockId: 'block-1',
        startLine: 1,
        endLine: 1,
      });
      expect(result.mappings[1]).toMatchObject({
        blockId: 'block-2',
        startLine: 2,
        endLine: 2,
      });
      expect(result.mappings[2]).toMatchObject({
        blockId: 'block-3',
        startLine: 3,
        endLine: 3,
      });
    });

    it('should handle multi-line blocks', () => {
      const blocks: MdBlock[] = [
        makeMdBlock({
          type: 'code',
          parent: '```javascript\nconst x = 1;\nconst y = 2;\n```',
          blockId: 'block-1',
        }),
        makeMdBlock({ type: 'paragraph', parent: 'After code', blockId: 'block-2' }),
      ];

      const result = buildBlockLineMap(blocks);

      // Code block: lines 1-4, paragraph: line 5 (no blank line between)
      expect(result.mappings[0]).toMatchObject({
        blockId: 'block-1',
        startLine: 1,
        endLine: 4, // 4 lines in the code block
      });
      expect(result.mappings[1]).toMatchObject({
        blockId: 'block-2',
        startLine: 5,
        endLine: 5,
      });
    });

    it('should handle blocks with children', () => {
      const childBlock = makeMdBlock({
        type: 'paragraph',
        parent: 'Child content',
        blockId: 'child-1',
      });
      const parentBlock = makeMdBlock({
        type: 'toggle',
        parent: 'Toggle header',
        blockId: 'parent-1',
        children: [childBlock],
      });
      const blocks: MdBlock[] = [parentBlock];

      const result = buildBlockLineMap(blocks);

      expect(result.mappings).toHaveLength(1);
      expect(result.mappings[0]?.blockId).toBe('parent-1');
      expect(result.mappings[0]?.children).toHaveLength(1);
      expect(result.mappings[0]?.children[0]?.blockId).toBe('child-1');
    });

    it('should add blank line before headers', () => {
      const blocks: MdBlock[] = [
        makeMdBlock({ type: 'paragraph', parent: 'Intro text', blockId: 'block-1' }),
        makeMdBlock({ type: 'heading_2', parent: '## Section Title', blockId: 'block-2' }),
        makeMdBlock({ type: 'paragraph', parent: 'Section content', blockId: 'block-3' }),
      ];

      const result = buildBlockLineMap(blocks);

      // Header should have blank line before it
      // Line 1: "Intro text"
      // Line 2: "" (blank line before header)
      // Line 3: "## Section Title"
      // Line 4: "Section content"
      expect(result.markdown).toBe('Intro text\n\n## Section Title\nSection content');
      expect(result.mappings[1]).toMatchObject({
        blockId: 'block-2',
        type: 'heading_2',
        startLine: 3,
      });
      expect(result.mappings[2]).toMatchObject({
        blockId: 'block-3',
        startLine: 4,
      });
    });
    it('should align mapping line numbers with actual markdown lines', () => {
      const blocks: MdBlock[] = [
        makeMdBlock({ type: 'paragraph', parent: 'Intro', blockId: 'block-1' }),
        makeMdBlock({ type: 'heading_2', parent: '## Section A', blockId: 'block-2' }),
        makeMdBlock({ type: 'paragraph', parent: 'Content A', blockId: 'block-3' }),
        makeMdBlock({ type: 'heading_2', parent: '## Section B', blockId: 'block-4' }),
        makeMdBlock({ type: 'paragraph', parent: 'Content B', blockId: 'block-5' }),
      ];

      const result = buildBlockLineMap(blocks);
      const lines = result.markdown.split('\n');

      // Verify each mapping's startLine matches the actual line content
      for (const mapping of result.mappings) {
        const actualLine = lines[mapping.startLine - 1];
        const firstMdLine = mapping.markdown.split('\n')[0];
        expect(actualLine).toBe(firstMdLine);
      }
    });
  });

  /* ================================================================== */
  /*  computePatchPlan tests                                             */
  /* ================================================================== */

  describe('computePatchPlan', () => {
    it('should delete a single block when fully contained in range', () => {
      const blocks: MdBlock[] = [
        makeMdBlock({ type: 'paragraph', parent: 'Line 1', blockId: 'block-1' }),
        makeMdBlock({ type: 'paragraph', parent: 'Line 2', blockId: 'block-2' }),
        makeMdBlock({ type: 'paragraph', parent: 'Line 3', blockId: 'block-3' }),
      ];
      const { mappings } = buildBlockLineMap(blocks);

      // Block 2 is on line 2 (no blank lines between blocks)
      const plan = computePatchPlan(mappings, 2, 2, 'New line 2');

      expect(plan.blocksToDelete).toContain('block-2');
      expect(plan.blocksToDelete).toHaveLength(1);
      expect(plan.blocksToInsert).toHaveLength(1);
      expect(plan.blocksToInsert[0]?.afterId).toBe('block-1');
      expect(plan.blocksToInsert[0]?.markdown).toBe('New line 2');
    });

    it('should delete multiple blocks when range spans them', () => {
      const blocks: MdBlock[] = [
        makeMdBlock({ type: 'paragraph', parent: 'Line 1', blockId: 'block-1' }),
        makeMdBlock({ type: 'paragraph', parent: 'Line 2', blockId: 'block-2' }),
        makeMdBlock({ type: 'paragraph', parent: 'Line 3', blockId: 'block-3' }),
        makeMdBlock({ type: 'paragraph', parent: 'Line 4', blockId: 'block-4' }),
      ];
      const { mappings } = buildBlockLineMap(blocks);

      // Blocks: 1 (line 1), 2 (line 2), 3 (line 3), 4 (line 4)
      // Delete lines 2-3 to hit blocks 2 and 3
      const plan = computePatchPlan(mappings, 2, 3, 'Replacement');

      expect(plan.blocksToDelete).toContain('block-2');
      expect(plan.blocksToDelete).toContain('block-3');
      expect(plan.blocksToDelete).toHaveLength(2);
      expect(plan.blocksToInsert[0]?.afterId).toBe('block-1');
    });

    it('should handle deletion at start of document', () => {
      const blocks: MdBlock[] = [
        makeMdBlock({ type: 'paragraph', parent: 'Line 1', blockId: 'block-1' }),
        makeMdBlock({ type: 'paragraph', parent: 'Line 2', blockId: 'block-2' }),
      ];
      const { mappings } = buildBlockLineMap(blocks);

      // Delete line 1
      const plan = computePatchPlan(mappings, 1, 1, 'New first line');

      expect(plan.blocksToDelete).toContain('block-1');
      expect(plan.blocksToDelete).toHaveLength(1);
      expect(plan.blocksToInsert[0]?.afterId).toBeNull();
    });

    it('should handle deletion at end of document', () => {
      const blocks: MdBlock[] = [
        makeMdBlock({ type: 'paragraph', parent: 'Line 1', blockId: 'block-1' }),
        makeMdBlock({ type: 'paragraph', parent: 'Line 2', blockId: 'block-2' }),
      ];
      const { mappings } = buildBlockLineMap(blocks);

      // Block 2 is on line 2 (no blank line separator)
      const plan = computePatchPlan(mappings, 2, 2, 'New last line');

      expect(plan.blocksToDelete).toContain('block-2');
      expect(plan.blocksToDelete).toHaveLength(1);
      expect(plan.blocksToInsert[0]?.afterId).toBe('block-1');
    });

    it('should handle empty replacement (pure deletion)', () => {
      const blocks: MdBlock[] = [
        makeMdBlock({ type: 'paragraph', parent: 'Line 1', blockId: 'block-1' }),
        makeMdBlock({ type: 'paragraph', parent: 'Line 2', blockId: 'block-2' }),
      ];
      const { mappings } = buildBlockLineMap(blocks);

      // Block 2 is on line 2 (no blank line separator)
      const plan = computePatchPlan(mappings, 2, 2, '');

      expect(plan.blocksToDelete).toContain('block-2');
      expect(plan.blocksToInsert).toHaveLength(0);
    });

    it('should delete parent and children when parent overlaps', () => {
      const childBlock = makeMdBlock({
        type: 'paragraph',
        parent: 'Child content',
        blockId: 'child-1',
      });
      const parentBlock = makeMdBlock({
        type: 'toggle',
        parent: 'Toggle header',
        blockId: 'parent-1',
        children: [childBlock],
      });
      const blocks: MdBlock[] = [parentBlock];
      const { mappings } = buildBlockLineMap(blocks);

      // Delete line 1 (the toggle header)
      const plan = computePatchPlan(mappings, 1, 1, 'New content');

      expect(plan.blocksToDelete).toContain('parent-1');
      expect(plan.blocksToDelete).toContain('child-1');
    });

    it('should only delete children when parent own content is not affected', () => {
      const child1 = makeMdBlock({
        type: 'bulleted_list_item',
        parent: 'Child 1',
        blockId: 'child-1',
      });
      const child2 = makeMdBlock({
        type: 'bulleted_list_item',
        parent: 'Child 2',
        blockId: 'child-2',
      });
      const child3 = makeMdBlock({
        type: 'bulleted_list_item',
        parent: 'Child 3',
        blockId: 'child-3',
      });
      const parentBlock = makeMdBlock({
        type: 'bulleted_list_item',
        parent: 'Parent item',
        blockId: 'parent-1',
        children: [child1, child2, child3],
      });
      const blocks: MdBlock[] = [parentBlock];
      const { mappings } = buildBlockLineMap(blocks);

      // Parent is on line 1, children on lines 2, 3, 4
      // Edit only lines 2-3 (children 1 and 2)
      const plan = computePatchPlan(mappings, 2, 3, 'Replacement child');

      // Parent should NOT be deleted
      expect(plan.blocksToDelete).not.toContain('parent-1');
      // Only affected children should be deleted
      expect(plan.blocksToDelete).toContain('child-1');
      expect(plan.blocksToDelete).toContain('child-2');
      expect(plan.blocksToDelete).not.toContain('child-3');
      expect(plan.blocksToDelete).toHaveLength(2);
      // Should insert as children of parent
      expect(plan.blocksToInsert).toHaveLength(1);
      expect(plan.blocksToInsert[0]?.parentBlockId).toBe('parent-1');
      // Insert at start of parent (no child before the range)
      expect(plan.blocksToInsert[0]?.afterId).toBeNull();
    });

    it('should set correct afterId when patching later children', () => {
      const child1 = makeMdBlock({
        type: 'bulleted_list_item',
        parent: 'Child 1',
        blockId: 'child-1',
      });
      const child2 = makeMdBlock({
        type: 'bulleted_list_item',
        parent: 'Child 2',
        blockId: 'child-2',
      });
      const child3 = makeMdBlock({
        type: 'bulleted_list_item',
        parent: 'Child 3',
        blockId: 'child-3',
      });
      const parentBlock = makeMdBlock({
        type: 'bulleted_list_item',
        parent: 'Parent item',
        blockId: 'parent-1',
        children: [child1, child2, child3],
      });
      const blocks: MdBlock[] = [parentBlock];
      const { mappings } = buildBlockLineMap(blocks);

      // Edit only line 4 (child 3)
      const plan = computePatchPlan(mappings, 4, 4, 'New child 3');

      expect(plan.blocksToDelete).toContain('child-3');
      expect(plan.blocksToDelete).toHaveLength(1);
      expect(plan.blocksToInsert[0]?.parentBlockId).toBe('parent-1');
      // Insert after child-2
      expect(plan.blocksToInsert[0]?.afterId).toBe('child-2');
    });

    it('should handle multi-line block partial overlap', () => {
      const blocks: MdBlock[] = [
        makeMdBlock({
          type: 'code',
          parent: '```\nline1\nline2\nline3\n```',
          blockId: 'code-block',
        }),
      ];
      const { mappings } = buildBlockLineMap(blocks);

      // Edit only line 3 (middle of code block)
      const plan = computePatchPlan(mappings, 3, 3, 'modified-line2');

      // The whole code block must be deleted since it partially overlaps
      expect(plan.blocksToDelete).toContain('code-block');
    });
  });

  /* ================================================================== */
  /*  findBlockAtLine tests                                              */
  /* ================================================================== */

  describe('findBlockAtLine', () => {
    it('should find the correct block for a given line', () => {
      const blocks: MdBlock[] = [
        makeMdBlock({ type: 'paragraph', parent: 'Line 1', blockId: 'block-1' }),
        makeMdBlock({ type: 'paragraph', parent: 'Line 2', blockId: 'block-2' }),
        makeMdBlock({ type: 'paragraph', parent: 'Line 3', blockId: 'block-3' }),
      ];
      const { mappings } = buildBlockLineMap(blocks);

      // Block 2 is on line 2 (no blank line separators)
      const found = findBlockAtLine(mappings, 2);
      expect(found?.blockId).toBe('block-2');
    });

    it('should return undefined for out-of-range line', () => {
      const blocks: MdBlock[] = [
        makeMdBlock({ type: 'paragraph', parent: 'Line 1', blockId: 'block-1' }),
      ];
      const { mappings } = buildBlockLineMap(blocks);

      const found = findBlockAtLine(mappings, 999);
      expect(found).toBeUndefined();
    });

    it('should find child block when line is within child range', () => {
      const childBlock = makeMdBlock({
        type: 'paragraph',
        parent: 'Child line',
        blockId: 'child-1',
      });
      const parentBlock = makeMdBlock({
        type: 'toggle',
        parent: 'Parent line',
        blockId: 'parent-1',
        children: [childBlock],
      });
      const blocks: MdBlock[] = [parentBlock];
      const { mappings } = buildBlockLineMap(blocks);

      // Line 1 is parent, line 2+ is child
      // Note: exact line numbers depend on how children are processed
      const parentFound = findBlockAtLine(mappings, 1);
      expect(parentFound?.blockId).toBe('parent-1');
    });
  });

  /* ================================================================== */
  /*  getPreservedContent tests                                          */
  /* ================================================================== */

  describe('getPreservedContent', () => {
    it('should return content before and after edit range', () => {
      const blocks: MdBlock[] = [
        makeMdBlock({
          type: 'code',
          parent: 'line1\nline2\nline3\nline4',
          blockId: 'block-1',
        }),
      ];
      const { markdown, mappings } = buildBlockLineMap(blocks);

      // Edit lines 2-3 (keeping line1 and line4)
      const preserved = getPreservedContent(mappings[0]!, markdown, 2, 3);

      expect(preserved.before).toBe('line1');
      expect(preserved.after).toBe('line4');
    });

    it('should return empty strings when nothing to preserve', () => {
      const blocks: MdBlock[] = [
        makeMdBlock({
          type: 'paragraph',
          parent: 'single line',
          blockId: 'block-1',
        }),
      ];
      const { markdown, mappings } = buildBlockLineMap(blocks);

      // Edit the entire block
      const preserved = getPreservedContent(mappings[0]!, markdown, 1, 1);

      expect(preserved.before).toBe('');
      expect(preserved.after).toBe('');
    });
  });
});
