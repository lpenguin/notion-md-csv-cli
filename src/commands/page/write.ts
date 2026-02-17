/**
 * notion-cli page write <page-id> --file <path>
 *
 * Replace a Notion page's content with Markdown from a file or stdin.
 * Uses @tryfabric/martian to convert Markdown → Notion blocks.
 *
 * WARNING: This replaces ALL existing content on the page.
 * Use `page patch` for partial edits.
 *
 * This command is NOT idempotent (replaces content).
 */

import { type Command } from 'commander';
import { readFileSync } from 'node:fs';
import { getClient } from '../../lib/client.js';
import { markdownToNotionBlocks } from '../../lib/markdown.js';
import { printSuccess, printError, isJsonMode } from '../../lib/output.js';
import { isDryRun } from '../../lib/safety.js';
import { withRateLimit } from '../../lib/rate-limit.js';
import { parseNotionId } from '../../utils/id.js';
import { unescapeString } from '../../utils/string.js';
import { type GlobalOptions, type PageWriteResult } from '../../lib/types.js';
import { toCliError } from '../../lib/errors.js';
import { ValidationError } from '../../lib/errors.js';
import * as logger from '../../utils/logger.js';

export function registerPageWriteCommand(page: Command): void {
  page
    .command('write')
    .description('Replace a Notion page content with Markdown. Reads from --file or stdin.')
    .argument('<page-id>', 'Notion page ID or URL')
    .option('-f, --file <path>', 'Path to Markdown file')
    .option('--content <markdown>', 'Inline Markdown content')
    .action(async (rawId: string, cmdOpts: { file?: string; content?: string }) => {
      try {
        const opts = page.optsWithGlobals<GlobalOptions>();
        const pageId = parseNotionId(rawId);
        const client = getClient(opts.token);

        // Get markdown content from file, --content, or stdin
        const markdown = await resolveContent(cmdOpts.file, cmdOpts.content);

        // Convert to Notion blocks
        const blocks = markdownToNotionBlocks(markdown);

        logger.debug(`Will replace page content with ${String(blocks.length)} blocks.`);

        // Dry run check
        if (isDryRun(opts.dryRun)) {
          if (isJsonMode()) {
            printSuccess({
              pageId,
              blocksWritten: blocks.length,
              dryRun: true,
            });
          }
          return;
        }

        // Clear existing content using erase_content: true
        await withRateLimit(
          () =>
            client.pages.update({
              page_id: pageId,
              erase_content: true,
            }),
          'pages.update (erase_content)',
        );

        // Append new blocks (in chunks of 100 — Notion API limit)
        let totalWritten = 0;
        for (let i = 0; i < blocks.length; i += 100) {
          const chunk = blocks.slice(i, i + 100);
          await withRateLimit(
            () =>
              client.blocks.children.append({
                block_id: pageId,
                children: chunk,
              }),
            'blocks.children.append',
          );
          totalWritten += chunk.length;
        }

        const result: PageWriteResult = {
          pageId,
          blocksWritten: totalWritten,
        };

        if (isJsonMode()) {
          printSuccess(result);
        }
      } catch (err) {
        const cliErr = toCliError(err);
        printError(cliErr.code, cliErr.message);
        process.exitCode = cliErr.exitCode;
      }
    });
}

/**
 * Resolve Markdown content from file, inline, or stdin.
 */
async function resolveContent(
  filePath?: string,
  inlineContent?: string,
): Promise<string> {
  if (filePath !== undefined) {
    return readFileSync(filePath, 'utf-8');
  }

  if (inlineContent !== undefined) {
    return unescapeString(inlineContent);
  }

  // Read from stdin
  if (!process.stdin.isTTY) {
    return readStdin();
  }

  throw new ValidationError('No content provided. Use --file, --content, or pipe via stdin.');
}

function readStdin(): Promise<string> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    process.stdin.on('data', (chunk: Buffer) => chunks.push(chunk));
    process.stdin.on('end', () => resolve(Buffer.concat(chunks).toString('utf-8')));
    process.stdin.on('error', reject);
  });
}
