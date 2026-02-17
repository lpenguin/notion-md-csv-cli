/**
 * notion-cli db list
 *
 * List all Notion databases accessible to the integration.
 *
 * This command is idempotent and read-only.
 */

import { type Command } from 'commander';
import { getClient } from '../../lib/client.js';
import { printSuccess, printError, formatTable, isJsonMode } from '../../lib/output.js';
import { withRateLimit } from '../../lib/rate-limit.js';
import { type GlobalOptions, type SearchResultItem } from '../../lib/types.js';
import { toCliError } from '../../lib/errors.js';
import * as logger from '../../utils/logger.js';

export function registerDbListCommand(db: Command): void {
  db.command('list')
    .description('List accessible Notion databases.')
    .option('-q, --query <text>', 'Filter databases by title')
    .option('-l, --limit <n>', 'Maximum results', '20')
    .option('--cursor <cursor>', 'Pagination cursor')
    .action(async (cmdOpts: { query?: string; limit?: string; cursor?: string }) => {
      try {
        const opts = db.optsWithGlobals<GlobalOptions>();
        const client = getClient(opts.token);
        const limit = parseInt(cmdOpts.limit ?? '20', 10);

        const response = await withRateLimit(
          () =>
            client.search({
              query: cmdOpts.query ?? '',
              filter: { value: 'data_source', property: 'object' },
              page_size: Math.min(limit, 100),
              start_cursor: cmdOpts.cursor,
            }),
          'search',
        );

        const results: SearchResultItem[] = response.results.map((item) => {
          const db = item as Record<string, unknown>;
          const titleArr = db['title'] as Array<Record<string, unknown>> | undefined;
          let title = 'Untitled';
          if (titleArr !== undefined && titleArr.length > 0) {
            title = (titleArr[0]?.['plain_text'] as string | undefined) ?? 'Untitled';
          }

          return {
            id: item.id,
            type: 'database' as const,
            title,
            url: (db['url'] as string | undefined) ?? '',
            lastEditedTime: (db['last_edited_time'] as string | undefined) ?? '',
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
            logger.info('No databases found.');
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
    });
}
