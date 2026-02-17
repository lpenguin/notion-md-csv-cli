/**
 * Markdown conversion wrappers.
 *
 * - Markdown → Notion blocks: @tryfabric/martian
 * - Notion → Markdown: notion-to-md (with unified converter)
 *
 * This module provides a clean interface over both libraries.
 * 
 * IMPORTANT: All Notion→Markdown conversion uses `mdBlocksToMarkdown()` 
 * to ensure consistent output between `page read` and `page patch`.
 */

import { markdownToBlocks } from '@tryfabric/martian';
import { NotionToMarkdown } from 'notion-to-md';
import { type MdBlock } from 'notion-to-md/build/types/index.js';
import { type Client } from '@notionhq/client';
import { type BlockObjectRequest, type BlockObjectResponse, type PartialBlockObjectResponse } from '@notionhq/client/build/src/api-endpoints.js';
import { type BlockLineMapping, type BlockLineMapResult } from './types.js';
import * as logger from '../utils/logger.js';
import { withRateLimit } from './rate-limit.js';

// Re-export MdBlock for use in other modules
export type { MdBlock } from 'notion-to-md/build/types/index.js';

/** Shape of a child_page block from the Notion API. */
interface ChildPageNotionBlock {
  id: string;
  child_page?: { title?: string };
}

/**
 * Custom implementation of blocksToMarkdown that fetches children in parallel using a queue.
 */
async function blocksToMarkdownParallel(
  n2m: NotionToMarkdown,
  client: Client,
  blocks?: Array<PartialBlockObjectResponse | BlockObjectResponse>,
  // No longer taking queue, will use withRateLimit
): Promise<MdBlock[]> {
  if (!blocks) return [];

  const mdBlocks: MdBlock[] = await Promise.all(
    blocks.map(async (block, index) => {
      const result: MdBlock = {
        // @ts-ignore
        type: block.type,
        blockId: block.id,
        parent: '',
        children: [],
      };

      // Skip unsupported or restricted blocks
      // @ts-ignore
      if (block.type === 'unsupported' || !('type' in block)) {
        return result;
      }

      // Handle numbered list items: inject the current index for markdown conversion
      // Notion API returns chunks, and typically notion-to-md expects to calculate 
      // these IDs sequentially. Here we simulate the index for the current list.
      // @ts-ignore
      if (block.type === 'numbered_list_item') {
        // Calculate the relative index in the current list sequence
        let listIndex = 1;
        for (let i = index - 1; i >= 0; i--) {
          const prevBlock = blocks[i];
          // @ts-ignore
          if (prevBlock && 'type' in prevBlock && prevBlock.type === 'numbered_list_item') {
            listIndex++;
          } else {
            break;
          }
        }
        // @ts-ignore
        block.numbered_list_item.number = listIndex;
      }

      // Convert the block itself to markdown. 
      // We don't queue this as it's a local CPU operation, but we await it.
      // @ts-ignore
      result.parent = await n2m.blockToMarkdown(block);

      // Recursive fetch for children
      if ('has_children' in block && block.has_children) {
        const blockId = block.id;

        // Fetch children using the shared specialized queue
        const childBlocks = await withRateLimit(
          async () => {
            const results: Array<PartialBlockObjectResponse | BlockObjectResponse> = [];
            let cursor: string | undefined;
            do {
              const response = await client.blocks.children.list({
                block_id: blockId,
                start_cursor: cursor,
              });
              results.push(...response.results);
              cursor = response.next_cursor ?? undefined;
            } while (cursor !== undefined);
            return results;
          },
          `blocks.children.list(${blockId})`,
        );

        // Recursively convert children
        result.children = await blocksToMarkdownParallel(n2m, client, childBlocks);
      }

      return result;
    }),
  );

  return mdBlocks;
}

/**
 * Convert a Markdown string to an array of Notion block objects.
 * Uses @tryfabric/martian for the conversion.
 */
export function markdownToNotionBlocks(markdown: string): BlockObjectRequest[] {
  logger.debug(`Converting ${String(markdown.length)} chars of Markdown to Notion blocks.`);

  const blocks = markdownToBlocks(markdown) as BlockObjectRequest[];

  logger.debug(`Produced ${String(blocks.length)} Notion blocks.`);
  return blocks;
}

/**
 * Unified MdBlock to Markdown converter.
 * 
 * Converts MdBlocks to markdown while tracking which lines each block contributes.
 * This is the SINGLE source of truth for Notion→Markdown conversion.
 * 
 * Used by both `page read` and `page patch` to ensure consistent line numbers.
 * 
 * @param blocks - Array of MdBlocks from notion-to-md
 * @returns The markdown string and a mapping of blocks to line ranges
 */
export function mdBlocksToMarkdown(blocks: readonly MdBlock[]): BlockLineMapResult {
  const mappings: BlockLineMapping[] = [];
  const outputParts: string[] = [];
  let currentLine = 1;

  for (let i = 0; i < blocks.length; i++) {
    const block = blocks[i] as MdBlock;

    // Add blank line before headers (except the first block).
    // Only add if previous part isn't already empty to avoid triple newlines.
    if (i > 0 && block.parent.trimStart().startsWith('#')) {
      const prevPart = outputParts[outputParts.length - 1] ?? '';
      if (prevPart !== '') {
        outputParts.push(''); // blank-line separator
        currentLine += 1;
      }
    }

    const result = processBlockToMarkdown(block, currentLine, 0);
    mappings.push(result.mapping);
    outputParts.push(result.markdown);

    // Count lines in this block's markdown
    const blockLineCount = result.markdown.split('\n').length;
    currentLine += blockLineCount;
  }

  const markdown = outputParts.join('\n').trim();

  return { markdown, mappings };
}

/**
 * Process a single block and its children recursively.
 * Returns the markdown and line mapping for this block.
 */
function processBlockToMarkdown(
  block: MdBlock,
  startLine: number,
  indentLevel: number,
): { mapping: BlockLineMapping; markdown: string } {
  const indent = '    '.repeat(indentLevel);
  let markdown = '';
  const childMappings: BlockLineMapping[] = [];

  // The block's own content (already converted to markdown by notion-to-md)
  const parentContent = block.parent;
  const parentLines = parentContent.split('\n');

  // Apply indent to each line of parent content
  const indentedParent = parentLines
    .map((line) => (line === '' ? '' : `${indent}${line}`))
    .join('\n');

  markdown += indentedParent;
  let currentLine = startLine + parentLines.length;

  // Process children with increased indentation
  if (block.children.length > 0) {
    for (const child of block.children) {
      // Add newline separator (ends the previous line, doesn't create a blank line)
      markdown += '\n';

      const childResult = processBlockToMarkdown(child, currentLine, indentLevel + 1);
      childMappings.push(childResult.mapping);
      markdown += childResult.markdown;

      currentLine += childResult.markdown.split('\n').length;
    }
  }

  // Calculate end line
  const endLine = startLine + markdown.split('\n').length - 1;

  const mapping: BlockLineMapping = {
    blockId: block.blockId,
    type: block.type ?? 'unknown',
    startLine,
    endLine,
    markdown: indentedParent, // Just this block's content, not children
    children: childMappings,
  };

  return { mapping, markdown };
}

/**
 * Fetch a Notion page's content as MdBlocks (preserving block IDs).
 * Used for surgical patching where we need to track block → line mappings.
 */
export async function fetchPageMdBlocks(
  client: Client,
  pageId: string,
): Promise<MdBlock[]> {
  logger.debug(`Fetching page ${pageId} as MdBlocks.`);

  const n2m = new NotionToMarkdown({ notionClient: client });

  // Custom transformer to prevent embedding child pages (only show a link/title)
  n2m.setCustomTransformer('child_page', (block) => {
    const cpBlock = block as unknown as ChildPageNotionBlock;
    const title = cpBlock.child_page?.title ?? 'Untitled Page';
    const id = block.id.replace(/-/g, '');
    return `[[${title}]](https://www.notion.so/${id})`;
  });

  // Fetch top-level blocks
  const topLevelBlocks = await withRateLimit(
    async () => {
      const results: Array<PartialBlockObjectResponse | BlockObjectResponse> = [];
      let cursor: string | undefined;
      do {
        const response = await client.blocks.children.list({
          block_id: pageId,
          start_cursor: cursor,
        });
        results.push(...response.results);
        cursor = response.next_cursor ?? undefined;
      } while (cursor !== undefined);
      return results;
    },
    `blocks.children.list(${pageId})`,
  );

  // Convert blocks to markdown with parallel fetching for children via queue
  const blocks = await blocksToMarkdownParallel(n2m, client, topLevelBlocks);

  // Fix child_page blocks to be treated as paragraphs
  fixChildPageBlocks(blocks);

  logger.debug(`Fetched ${String(blocks.length)} MdBlocks.`);
  return blocks;
}

/**
 * Fetch a Notion page's content and convert to Markdown.
 * Uses the unified mdBlocksToMarkdown converter.
 */
export async function notionPageToMarkdown(
  client: Client,
  pageId: string,
): Promise<string> {
  logger.debug(`Fetching page ${pageId} and converting to Markdown.`);

  const blocks = await fetchPageMdBlocks(client, pageId);
  const { markdown } = mdBlocksToMarkdown(blocks);

  logger.debug(`Converted page to ${String(markdown.length)} chars of Markdown.`);
  return markdown;
}

/**
 * Clean raw Markdown output:
 * - Trim leading/trailing whitespace
 * - Collapse 3+ consecutive newlines into exactly 2
 */
export function cleanMarkdownOutput(raw: string): string {
  return raw
    .trim()
    .replace(/\n{3,}/g, '\n\n');
}

/**
 * Recursively rewrite child_page blocks to paragraph so that
 * toMarkdownString includes them in the output.
 */
export function fixChildPageBlocks(mdBlocks: MdBlock[]): void {
  for (const b of mdBlocks) {
    if (b.type === 'child_page') {
      b.type = 'paragraph';
    }
    if (b.children.length > 0) {
      fixChildPageBlocks(b.children);
    }
  }
}

/**
 * Convert Markdown to numbered-line format for patch operations.
 * Each line is prefixed with its 1-based line number.
 *
 * Example output:
 *   1: # Hello World
 *   2:
 *   3: Some content here.
 */
export function addLineNumbers(markdown: string): string {
  const lines = markdown.split('\n');
  const padWidth = String(lines.length).length;
  return lines
    .map((line, i) => `${String(i + 1).padStart(padWidth)}: ${line}`)
    .join('\n');
}

/**
 * Remove line numbers from numbered-line format.
 * Strips the "N: " prefix from each line.
 */
export function stripLineNumbers(numbered: string): string {
  return numbered
    .split('\n')
    .map((line) => line.replace(/^\s*\d+:\s?/, ''))
    .join('\n');
}

/**
 * Extract the title (first H1) from Markdown content.
 */
export function extractTitle(markdown: string): string {
  const match = /^#\s+(.+)$/m.exec(markdown);
  return match?.[1]?.trim() ?? 'Untitled';
}
