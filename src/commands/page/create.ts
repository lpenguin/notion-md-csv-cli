/**
 * notion-cli page create --parent <id> --file <path>
 *
 * Create a new Notion page from Markdown content.
 * The page is created as a child of the specified parent page or database.
 *
 * This command is NOT idempotent (creates a new page each time).
 */

import { type Command } from 'commander';
import { readFileSync } from 'node:fs';
import { getClient } from '../../lib/client.js';
import { markdownToNotionBlocks, extractTitle } from '../../lib/markdown.js';
import { markdownToRichText } from '@tryfabric/martian';
import { printSuccess, printError, isJsonMode } from '../../lib/output.js';
import { isDryRun } from '../../lib/safety.js';
import { withRetry } from '../../lib/rate-limit.js';
import { parseNotionId } from '../../utils/id.js';
import { unescapeString } from '../../utils/string.js';
import { type GlobalOptions } from '../../lib/types.js';
import { toCliError, ValidationError } from '../../lib/errors.js';
import * as logger from '../../utils/logger.js';

export function registerPageCreateCommand(page: Command): void {
  page
    .command('create')
    .description('Create a new Notion page from Markdown.')
    .requiredOption('--parent <id>', 'Parent page or database ID')
    .option('-f, --file <path>', 'Path to Markdown file')
    .option('--content <markdown>', 'Inline Markdown content')
    .option('--title <title>', 'Page title (overrides H1 in content)')
    .option('--db', 'Parent is a database (creates a database entry)')
    .action(
      async (cmdOpts: {
        parent: string;
        file?: string;
        content?: string;
        title?: string;
        db?: boolean;
      }) => {
        try {
          const opts = page.optsWithGlobals<GlobalOptions>();
          const parentId = parseNotionId(cmdOpts.parent);
          const client = getClient(opts.token);

          // Get markdown content
          const markdown = resolveCreateContent(cmdOpts.file, cmdOpts.content);
          const title = cmdOpts.title ?? extractTitle(markdown);
          const blocks = markdownToNotionBlocks(markdown);

          logger.info(`Creating page "${title}" with ${String(blocks.length)} blocks.`);

          if (isDryRun(opts.dryRun)) {
            if (isJsonMode()) {
              printSuccess({ parentId, title, blocksCount: blocks.length, dryRun: true });
            } else {
              logger.info(`Dry run: Would create page "${title}" under parent ${parentId}.`);
            }
            return;
          }

          // Build the create request
          const titleRichText = markdownToRichText(title);

          const parent = cmdOpts.db === true
            ? { database_id: parentId }
            : { page_id: parentId };

          const properties = cmdOpts.db === true
            ? { title: { title: titleRichText } }
            : { title: { title: titleRichText } };

          // Create page (with first 100 blocks)
          const firstChunk = blocks.slice(0, 100);
          const createResult = await withRetry(
            () =>
              client.pages.create({
                parent: parent as { database_id: string } | { page_id: string },
                properties,
                children: firstChunk,
              }),
            'pages.create',
          );

          // Append remaining blocks in chunks
          for (let i = 100; i < blocks.length; i += 100) {
            const chunk = blocks.slice(i, i + 100);
            await withRetry(
              () =>
                client.blocks.children.append({
                  block_id: createResult.id,
                  children: chunk,
                }),
              'blocks.children.append',
            );
          }

          const result = {
            pageId: createResult.id,
            title,
            url: (createResult as Record<string, unknown>)['url'] ?? '',
            blocksWritten: blocks.length,
          };

          if (isJsonMode()) {
            printSuccess(result);
          } else {
            logger.success(`Created page: ${title} (${createResult.id})`);
          }
        } catch (err) {
          const cliErr = toCliError(err);
          printError(cliErr.code, cliErr.message);
          process.exitCode = cliErr.exitCode;
        }
      },
    );
}

function resolveCreateContent(filePath?: string, inlineContent?: string): string {
  if (filePath !== undefined) {
    return readFileSync(filePath, 'utf-8');
  }
  if (inlineContent !== undefined) {
    return unescapeString(inlineContent);
  }
  throw new ValidationError('No content provided. Use --file or --content.');
}
