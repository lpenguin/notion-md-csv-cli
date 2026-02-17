/**
 * notion-cli page list [--query <text>]
 *
 * Search/list Notion pages accessible to the integration.
 *
 * This command is idempotent and read-only.
 */

import { type Command } from 'commander';
import { getClient } from '../../lib/client.js';
import { printSuccess, printError, formatTable } from '../../lib/output.js';
import { isJsonMode } from '../../lib/output.js';
import { withRateLimit } from '../../lib/rate-limit.js';
import { type GlobalOptions, type SearchResultItem } from '../../lib/types.js';
import { toCliError } from '../../lib/errors.js';
import * as logger from '../../utils/logger.js';

export function registerPageListCommand(page: Command): void {
  page
    .command('list')
    .description('List/search Notion pages.')
    .option('-q, --query <text>', 'Search pages by title')
    .option('-l, --limit <n>', 'Maximum results to return', '10')
    .option('--cursor <cursor>', 'Pagination cursor from a previous response')
    .action(
      async (cmdOpts: { query?: string; limit?: string; cursor?: string }) => {
        try {
          const opts = page.optsWithGlobals<GlobalOptions>();
          const client = getClient(opts.token);
          const limit = parseInt(cmdOpts.limit ?? '10', 10);

          const response = await withRateLimit(
            () =>
              client.search({
                query: cmdOpts.query ?? '',
                filter: { value: 'page', property: 'object' },
                page_size: Math.min(limit, 100),
                start_cursor: cmdOpts.cursor,
              }),
            'search',
          );

          const results: SearchResultItem[] = response.results.map((item: any) => {
            const page = item as Record<string, unknown>;
            const props = page['properties'] as Record<string, Record<string, unknown>> | undefined;
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

            return {
              id: item.id,
              type: 'page' as const,
              title,
              url: (page['url'] as string | undefined) ?? '',
              lastEditedTime: (page['last_edited_time'] as string | undefined) ?? '',
            };
          });

          if (isJsonMode()) {
            printSuccess(
              { results },
              {
                hasMore: response.has_more,
                cursor: response.next_cursor ?? undefined,
              },
            );
          } else {
            if (results.length === 0) {
              logger.info('No pages found.');
            } else {
              for (const r of results) {
                const table = formatTable([
                  ['ID', r.id],
                  ['Title', r.title],
                  ['URL', r.url],
                  ['Last edited', r.lastEditedTime],
                ]);
                process.stdout.write(`${table}\n\n`);
              }
              if (response.has_more) {
                logger.info(`More results available. Use --cursor ${response.next_cursor ?? ''}`);
              }
            }
          }
        } catch (err) {
          const cliErr = toCliError(err);
          printError(cliErr.code, cliErr.message);
          process.exitCode = cliErr.exitCode;
        }
      },
    );
}
