/**
 * Markdown conversion wrappers.
 *
 * - Markdown → Notion blocks: @tryfabric/martian
 * - Notion → Markdown: notion-to-md
 *
 * This module provides a clean interface over both libraries.
 */

import { markdownToBlocks } from '@tryfabric/martian';
import { NotionToMarkdown } from 'notion-to-md';
import { type MdBlock } from 'notion-to-md/build/types/index.js';
import { type Client } from '@notionhq/client';
import { type BlockObjectRequest } from '@notionhq/client/build/src/api-endpoints.js';
import * as logger from '../utils/logger.js';

/** Shape of a child_page block from the Notion API. */
interface ChildPageNotionBlock {
  id: string;
  child_page?: { title?: string };
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
 * Fetch a Notion page's content and convert to Markdown.
 * Uses notion-to-md for the conversion.
 */
export async function notionPageToMarkdown(
  client: Client,
  pageId: string,
): Promise<string> {
  logger.debug(`Fetching page ${pageId} and converting to Markdown.`);

  const n2m = new NotionToMarkdown({ notionClient: client });
  
  // Custom transformer to prevent embedding child pages (only show a link/title)
  n2m.setCustomTransformer('child_page', (block) => {
    const cpBlock = block as unknown as ChildPageNotionBlock;
    const title = cpBlock.child_page?.title ?? 'Untitled Page';
    const id = block.id.replace(/-/g, '');
    return `[[${title}]](https://www.notion.so/${id})`;
  });

  const blocks = await n2m.pageToMarkdown(pageId);
  
  // Custom blocks like child_page might be ignored by toMarkdownString
  // if not handled specifically. We force them to be treated as paragraphs.
  fixChildPageBlocks(blocks);

  // notion-to-md v3 returns MdStringObject (Record<string, string>)
  const markdownResult = n2m.toMarkdownString(blocks);
  const result = markdownResult['parent'];

  logger.debug(`toMarkdownString produced ${String(result?.length)} chars.`);
  if (result !== undefined && result !== '') {
    logger.debug(`Final 100 chars: ${result.slice(-100)}`);
  }

  const output = cleanMarkdownOutput(result ?? '');

  logger.debug(`Converted page to ${String(output.length)} chars of Markdown.`);
  return output;
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
