/**
 * notion-cli db query <db-id> [--filter <json>] [--sort <json>]
 *
 * Query a Notion database and output results as CSV or JSON.
 *
 * This command is idempotent and read-only.
 */

import { type Command } from 'commander';
import { getClient } from '../../lib/client.js';
import { rowsToCsv } from '../../lib/csv.js';
import { printSuccess, printError, isJsonMode } from '../../lib/output.js';
import { withRetry } from '../../lib/rate-limit.js';
import { parseNotionId } from '../../utils/id.js';
import { type GlobalOptions } from '../../lib/types.js';
import { toCliError } from '../../lib/errors.js';
import * as logger from '../../utils/logger.js';

export function registerDbQueryCommand(db: Command): void {
  db.command('query')
    .description('Query a Notion database. Outputs CSV by default, JSON with --json.')
    .argument('<db-id>', 'Notion database ID or URL')
    .option('--filter <json>', 'Filter as JSON string (Notion API filter object)')
    .option('--sort <json>', 'Sort as JSON string (array of sort objects)')
    .option('-l, --limit <n>', 'Maximum rows to return', '100')
    .option('--cursor <cursor>', 'Pagination cursor')
    .action(
      async (
        rawId: string,
        cmdOpts: { filter?: string; sort?: string; limit?: string; cursor?: string },
      ) => {
        try {
          const opts = db.optsWithGlobals<GlobalOptions>();
          const dbId = parseNotionId(rawId);
          const client = getClient(opts.token);
          const limit = parseInt(cmdOpts.limit ?? '100', 10);

          // Parse filter and sort
          const filter = cmdOpts.filter !== undefined ? JSON.parse(cmdOpts.filter) as Record<string, unknown> : undefined;
          const parsedSort = cmdOpts.sort !== undefined ? JSON.parse(cmdOpts.sort) as Record<string, unknown> | Array<Record<string, unknown>> : undefined;
          const sorts = parsedSort !== undefined
            ? (Array.isArray(parsedSort) ? parsedSort : [parsedSort])
            : undefined;

          // Query the database
          const response = await withRetry(
            () =>
              client.databases.query({
                database_id: dbId,
                filter: filter as undefined,
                sorts: sorts as undefined,
                page_size: Math.min(limit, 100),
                start_cursor: cmdOpts.cursor,
              }),
            'databases.query',
          );

          // Extract property names from first result
          const results = response.results as Array<Record<string, unknown>>;
          const propertyNames = results.length > 0
            ? Object.keys(
                (results[0]?.['properties'] as Record<string, unknown> | undefined) ?? {},
              )
            : [];

          if (isJsonMode()) {
            printSuccess(
              { rows: results, propertyNames },
              {
                hasMore: response.has_more,
                cursor: response.next_cursor ?? undefined,
                totalCount: results.length,
              },
            );
          } else {
            // Output CSV to stdout
            const csv = rowsToCsv(
              results as Array<Record<string, unknown> & { id: string; properties: Record<string, Record<string, unknown>> }>,
              propertyNames,
            );
            process.stdout.write(csv);
            logger.success(`${String(results.length)} rows returned.`);
            if (response.has_more) {
              logger.info(`More results available. Use --cursor ${response.next_cursor ?? ''}`);
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
