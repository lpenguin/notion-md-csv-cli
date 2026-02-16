/**
 * Surgical block-level patching.
 *
 * Instead of deleting all blocks and recreating them, this module
 * enables targeted edits by tracking which markdown lines correspond
 * to which Notion blocks.
 *
 * Key concepts:
 * - BlockLineMapping: Maps a block ID to its line range in the markdown
 * - PatchPlan: Describes which blocks to delete and what to insert
 *
 * The flow:
 * 1. Fetch MdBlocks from Notion (via notion-to-md)
 * 2. Build line mapping via mdBlocksToMarkdown (unified converter in markdown.ts)
 * 3. Given a line range edit, compute which blocks are affected
 * 4. Execute the plan: delete affected blocks, insert new content
 */

import {
  type BlockLineMapping,
  type PatchPlan,
  type BlockInsert,
} from './types.js';

// Re-export the unified converter as buildBlockLineMap for backward compatibility
export { mdBlocksToMarkdown as buildBlockLineMap } from './markdown.js';

/**
 * Compute a patch plan given block mappings and a line range to replace.
 *
 * Determines which blocks need to be deleted and where to insert new content.
 *
 * Rules:
 * - Blocks fully contained in [startLine, endLine] are deleted
 * - Blocks that partially overlap are also deleted (they need to be reconstructed)
 * - New content is inserted after the last unaffected block before the range
 *
 * @param mappings - Block-to-line mappings from buildBlockLineMap
 * @param startLine - 1-indexed start line of the edit (inclusive)
 * @param endLine - 1-indexed end line of the edit (inclusive)
 * @param newContent - The replacement markdown content
 * @returns A plan describing deletions and insertions
 */
export function computePatchPlan(
  mappings: readonly BlockLineMapping[],
  startLine: number,
  endLine: number,
  newContent: string,
): PatchPlan {
  const blocksToDelete: string[] = [];
  let insertAfterId: string | null = null;
  let parentBlockId: string | undefined;

  // Find the block just before the edit range (for insertion point)
  // and collect all blocks that overlap with the edit range
  for (const mapping of mappings) {
    const blockResult = analyzeBlockOverlap(mapping, startLine, endLine);

    // Collect blocks to delete
    blocksToDelete.push(...blockResult.blocksToDelete);

    // If edits target only children, track the parent block ID for insertion
    if (blockResult.parentBlockId !== undefined) {
      parentBlockId = blockResult.parentBlockId;
      insertAfterId = blockResult.childInsertAfterId;
    } else if (mapping.endLine < startLine) {
      // Track the last top-level block that ends before our edit range
      insertAfterId = mapping.blockId;
    }
  }

  // Build insertion plan
  const blocksToInsert: BlockInsert[] = [];

  if (newContent.trim() !== '') {
    blocksToInsert.push({
      afterId: insertAfterId,
      markdown: newContent,
      ...(parentBlockId !== undefined ? { parentBlockId } : {}),
    });
  }

  return {
    blocksToDelete,
    blocksToInsert,
  };
}

/** Result of analyzing a block's overlap with an edit range. */
interface BlockOverlapResult {
  /** Block IDs that should be deleted. */
  readonly blocksToDelete: string[];
  /** If set, edits target only children of this parent block. */
  readonly parentBlockId?: string;
  /** When targeting children, insert after this child ID (null = start of parent). */
  readonly childInsertAfterId: string | null;
}

/**
 * Analyze a block (and its children) for overlap with a line range.
 *
 * Key distinction: if only child blocks overlap (not the parent's own content),
 * we delete only the affected children and mark the insertion as child-level.
 * This prevents destroying the parent block when editing nested content.
 *
 * @returns Overlap analysis with block IDs to delete and insertion context
 */
function analyzeBlockOverlap(
  mapping: BlockLineMapping,
  startLine: number,
  endLine: number,
): BlockOverlapResult {
  const blocksToDelete: string[] = [];

  // Calculate the parent's OWN line range (excluding children)
  const parentOwnEndLine =
    mapping.startLine + mapping.markdown.split('\n').length - 1;

  // Check if the parent's own content overlaps with the edit range
  const parentOwnOverlaps =
    mapping.startLine <= endLine && parentOwnEndLine >= startLine;

  if (parentOwnOverlaps) {
    // Parent's own content is affected - delete the whole block
    blocksToDelete.push(mapping.blockId);

    // Also delete all children (they'll be recreated with the parent)
    for (const child of mapping.children) {
      blocksToDelete.push(...collectAllBlockIds(child));
    }
    return { blocksToDelete, childInsertAfterId: null };
  }

  // Parent's own content is NOT affected - check children only
  let childInsertAfterId: string | null = null;
  let hasChildOverlap = false;

  for (const child of mapping.children) {
    const childOverlaps =
      child.startLine <= endLine && child.endLine >= startLine;

    if (childOverlaps) {
      hasChildOverlap = true;
      blocksToDelete.push(child.blockId);
      // Also delete grandchildren of affected children
      for (const grandchild of child.children) {
        blocksToDelete.push(...collectAllBlockIds(grandchild));
      }
    } else if (child.endLine < startLine) {
      // Track last child before the edit range for insertion point
      childInsertAfterId = child.blockId;
    }
  }

  if (hasChildOverlap) {
    return {
      blocksToDelete,
      parentBlockId: mapping.blockId,
      childInsertAfterId,
    };
  }

  return { blocksToDelete, childInsertAfterId: null };
}

/**
 * Recursively collect all block IDs from a mapping tree.
 */
function collectAllBlockIds(mapping: BlockLineMapping): string[] {
  const ids = [mapping.blockId];
  for (const child of mapping.children) {
    ids.push(...collectAllBlockIds(child));
  }
  return ids;
}

/**
 * Find a block mapping by line number.
 *
 * @param mappings - Block mappings to search
 * @param line - The line number to find
 * @returns The block containing this line, or undefined
 */
export function findBlockAtLine(
  mappings: readonly BlockLineMapping[],
  line: number,
): BlockLineMapping | undefined {
  for (const mapping of mappings) {
    if (line >= mapping.startLine && line <= mapping.endLine) {
      // Check if it's in a child
      const childMatch = findBlockAtLine(mapping.children, line);
      if (childMatch !== undefined) {
        return childMatch;
      }
      return mapping;
    }
  }
  return undefined;
}

/**
 * Get content that should be preserved from partially affected blocks.
 *
 * When a block partially overlaps with the edit range, we need to keep
 * the lines that are outside the edit range.
 *
 * @param mapping - The block mapping
 * @param markdown - Full markdown content
 * @param startLine - Edit start line
 * @param endLine - Edit end line
 * @returns Lines to preserve (before and after the edit range)
 */
export function getPreservedContent(
  mapping: BlockLineMapping,
  markdown: string,
  startLine: number,
  endLine: number,
): { before: string; after: string } {
  const allLines = markdown.split('\n');

  // Lines before the edit range that belong to this block
  const beforeLines: string[] = [];
  for (let i = mapping.startLine; i < startLine && i <= mapping.endLine; i++) {
    beforeLines.push(allLines[i - 1] ?? '');
  }

  // Lines after the edit range that belong to this block
  const afterLines: string[] = [];
  for (let i = endLine + 1; i <= mapping.endLine; i++) {
    afterLines.push(allLines[i - 1] ?? '');
  }

  return {
    before: beforeLines.join('\n'),
    after: afterLines.join('\n'),
  };
}
