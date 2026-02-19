/**
 * notion-cli page read <page-id>
 *
 * Fetch a Notion page and output its content as Markdown.
 *
 * This command is idempotent and read-only.
 */

import { type Command } from 'commander';
import { getClient } from '../../lib/client.js';
import { notionPageToMarkdown } from '../../lib/markdown.js';
import { withRateLimit } from '../../lib/rate-limit.js';
import { parseNotionId } from '../../utils/id.js';
import { type GlobalOptions } from '../../lib/types.js';
import { toCliError } from '../../lib/errors.js';
import { printSuccess, printError, isJsonMode } from '../../lib/output.js';
import * as logger from '../../utils/logger.js';

export function registerPageReadCommand(page: Command): void {
  page
    .command('read')
    .description('Fetch a Notion page and output as Markdown.')
    .argument('<page-id>', 'Notion page ID or URL')
    .action(async (rawId: string) => {
      try {
        const opts = page.optsWithGlobals<GlobalOptions>();
        const pageId = parseNotionId(rawId);
        const client = getClient(opts.token);

        // Fetch page metadata
        const pageObj = await withRateLimit(
          () => client.pages.retrieve({ page_id: pageId }),
          'pages.retrieve',
        );

        // Extract title
        const props = (pageObj as Record<string, unknown>)['properties'] as Record<string, Record<string, unknown>> | undefined;
        let title = 'Untitled';
        if (props !== undefined) {
          for (const prop of Object.values(props)) {
            if (prop['type'] === 'title') {
              const titleArr = prop['title'] as Array<Record<string, unknown>> | undefined;
              if (titleArr !== undefined && titleArr.length > 0) {
                title = (titleArr[0]?.['plain_text'] as string | undefined) ?? 'Untitled';
              }
              break;
            }
          }
        }

        // Extract parent ID
        const parent = (pageObj as Record<string, unknown>)['parent'] as
          | { type: string; [key: string]: unknown }
          | undefined;

        let parentId: string | undefined;
        if (parent) {
          switch (parent.type) {
            case 'database_id':
              parentId = parent.database_id as string;
              break;
            case 'page_id':
              parentId = parent.page_id as string;
              break;
            case 'block_id':
              parentId = parent.block_id as string;
              break;
            case 'workspace':
              parentId = 'workspace';
              break;
          }
        }

        // Fetch and convert content
        const markdown = await withRateLimit(
          () => notionPageToMarkdown(client, pageId),
          'pageToMarkdown',
        );

        const lastEditedTime = (pageObj as Record<string, unknown>)['last_edited_time'] as string;

        // Output
        if (isJsonMode()) {
          printSuccess({ pageId, parentId, title, markdown, lastEditedTime });
        } else {
          process.stdout.write(`${markdown}\n`);
          logger.success(`Read page: ${title}`);
        }
      } catch (err) {
        const cliErr = toCliError(err);
        if (isJsonMode()) {
          printError(cliErr.code, cliErr.message);
        } else {
          logger.error(cliErr.message);
        }
        process.exitCode = cliErr.exitCode;
      }
    });
}
