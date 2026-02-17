/**
 * notion-cli search <query>
 *
 * Unified search across all pages and databases accessible to the integration.
 * Returns IDs, titles, URLs, and types — perfect for AI agents to discover
 * content before reading/patching.
 *
 * Options:
 *   --type page|database   Filter by object type
 *   --sort last_edited     Sort by last edited time
 *   --limit N              Max results (default 10)
 *   --cursor <cursor>      Pagination cursor
 *
 * This command is idempotent and read-only.
 */

import { type Command } from 'commander';
import { getClient } from '../lib/client.js';
import { printSuccess, printError, formatTable, isJsonMode } from '../lib/output.js';
import { withRateLimit } from '../lib/rate-limit.js';
import { type GlobalOptions, type SearchResultItem, type SearchResults } from '../lib/types.js';
import { toCliError, ValidationError } from '../lib/errors.js';
import * as logger from '../utils/logger.js';

export function registerSearchCommand(program: Command): void {
  program
    .command('search')
    .description('Search across all Notion pages and databases.')
    .argument('<query>', 'Search query text')
    .option('--type <type>', 'Filter by type: page or database')
    .option('--sort <direction>', 'Sort by last_edited_time: ascending or descending', 'descending')
    .option('-l, --limit <n>', 'Maximum results to return', '10')
    .option('--cursor <cursor>', 'Pagination cursor from a previous response')
    .action(
      async (
        query: string,
        cmdOpts: { type?: string; sort?: string; limit?: string; cursor?: string },
      ) => {
        try {
          const opts = program.optsWithGlobals<GlobalOptions>();
          const client = getClient(opts.token);
          const limit = parseInt(cmdOpts.limit ?? '10', 10);

          // Validate type filter
          if (cmdOpts.type !== undefined && cmdOpts.type !== 'page' && cmdOpts.type !== 'database') {
            throw new ValidationError('--type must be "page" or "database".');
          }

          // Build search params
          const searchParams: Record<string, unknown> = {
            query,
            page_size: Math.min(limit, 100),
            start_cursor: cmdOpts.cursor,
          };

          if (cmdOpts.type !== undefined) {
            searchParams['filter'] = { value: cmdOpts.type, property: 'object' };
          }

          if (cmdOpts.sort !== undefined) {
            searchParams['sort'] = {
              direction: cmdOpts.sort,
              timestamp: 'last_edited_time',
            };
          }

          const response = await withRateLimit(
            () => client.search(searchParams as Parameters<typeof client.search>[0]),
            'search',
          );

          const results: SearchResultItem[] = response.results.map((item) => {
            const obj = item as Record<string, unknown>;
            const objectType = obj['object'] as string;
            let title = 'Untitled';

            if (objectType === 'page') {
              const props = obj['properties'] as Record<string, Record<string, unknown>> | undefined;
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
            } else if (objectType === 'database') {
              const titleArr = obj['title'] as Array<Record<string, unknown>> | undefined;
              if (titleArr !== undefined && titleArr.length > 0) {
                title = (titleArr[0]?.['plain_text'] as string | undefined) ?? 'Untitled';
              }
            }

            return {
              id: item.id,
              type: objectType as 'page' | 'database',
              title,
              url: (obj['url'] as string | undefined) ?? '',
              lastEditedTime: (obj['last_edited_time'] as string | undefined) ?? '',
            };
          });

          const searchResults: SearchResults = {
            results,
            hasMore: response.has_more,
            nextCursor: response.next_cursor ?? undefined,
          };

          if (isJsonMode()) {
            printSuccess(searchResults, {
              hasMore: response.has_more,
              cursor: response.next_cursor ?? undefined,
              totalCount: results.length,
            });
          } else {
            if (results.length === 0) {
              logger.info('No results found.');
            } else {
              for (const r of results) {
                const table = formatTable([
                  ['ID', r.id],
                  ['Type', r.type],
                  ['Title', r.title],
                  ['URL', r.url],
                  ['Last edited', r.lastEditedTime],
                ]);
                process.stdout.write(`${table}\n\n`);
              }
              if (searchResults.hasMore) {
                logger.info(
                  `More results available. Use --cursor ${searchResults.nextCursor ?? ''}`,
                );
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
