/**
 * notion-cli block append <parent-id> --file <path>
 *
 * Append Notion blocks (from Markdown) to a parent block or page.
 * Uses @tryfabric/martian to convert Markdown → Notion blocks.
 *
 * Safety: Requires confirmation unless --yes is passed.
 * This command is NOT idempotent (appends content each time).
 */

import { type Command } from 'commander';
import { readFileSync } from 'node:fs';
import { getClient } from '../../lib/client.js';
import { markdownToNotionBlocks } from '../../lib/markdown.js';
import { printSuccess, printError } from '../../lib/output.js';
import { confirmAction, isDryRun } from '../../lib/safety.js';
import { withRetry } from '../../lib/rate-limit.js';
import { parseNotionId } from '../../utils/id.js';
import { unescapeString } from '../../utils/string.js';
import { type GlobalOptions } from '../../lib/types.js';
import { toCliError, ValidationError } from '../../lib/errors.js';
import * as logger from '../../utils/logger.js';

export function registerBlockAppendCommand(block: Command): void {
  block
    .command('append')
    .description('Append blocks from Markdown to a parent block or page.')
    .argument('<parent-id>', 'Parent block or page ID')
    .option('-f, --file <path>', 'Path to Markdown file')
    .option('--content <markdown>', 'Inline Markdown content')
    .action(
      async (rawId: string, cmdOpts: { file?: string; content?: string }) => {
        try {
          const opts = block.optsWithGlobals<GlobalOptions>();
          const parentId = parseNotionId(rawId);
          const client = getClient(opts.token);

          // Resolve content
          let markdown: string;
          if (cmdOpts.file !== undefined) {
            markdown = readFileSync(cmdOpts.file, 'utf-8');
          } else if (cmdOpts.content !== undefined) {
            markdown = unescapeString(cmdOpts.content);
          } else {
            throw new ValidationError(
              'No content provided. Use --file or --content.',
            );
          }

          const blocks = markdownToNotionBlocks(markdown);

          logger.info(`Will append ${String(blocks.length)} blocks.`);

          if (isDryRun(opts.dryRun)) {
            printSuccess({ parentId, blocksCount: blocks.length, dryRun: true });
            return;
          }

          const confirmed = await confirmAction(
            `Append ${String(blocks.length)} blocks to ${parentId}?`,
            opts.yes === true,
          );
          if (!confirmed) {
            logger.info('Aborted.');
            return;
          }

          // Append in chunks
          let totalAppended = 0;
          for (let i = 0; i < blocks.length; i += 100) {
            const chunk = blocks.slice(i, i + 100);
            await withRetry(
              () =>
                client.blocks.children.append({
                  block_id: parentId,
                  children: chunk,
                }),
              'blocks.children.append',
            );
            totalAppended += chunk.length;
          }

          printSuccess({ parentId, blocksAppended: totalAppended });
          logger.success(`Appended ${String(totalAppended)} blocks.`);
        } catch (err) {
          const cliErr = toCliError(err);
          printError(cliErr.code, cliErr.message);
          process.exitCode = cliErr.exitCode;
        }
      },
    );
}
