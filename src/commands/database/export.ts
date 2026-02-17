/**
 * notion-cli db export <db-id> --out <file.csv>
 *
 * Export an entire Notion database to a CSV file.
 * Fetches all pages with pagination and writes to file or stdout.
 *
 * This command is idempotent and read-only.
 */

import { type Command } from 'commander';
import { writeFileSync } from 'node:fs';
import { getClient, resolveDataSourceId } from '../../lib/client.js';
import { rowsToCsv } from '../../lib/csv.js';
import { printSuccess, printError } from '../../lib/output.js';
import { withRateLimit } from '../../lib/rate-limit.js';
import { parseNotionId } from '../../utils/id.js';
import { type GlobalOptions } from '../../lib/types.js';
import { toCliError } from '../../lib/errors.js';
import * as logger from '../../utils/logger.js';
import type { QueryDataSourceResponse } from '@notionhq/client/build/src/api-endpoints.js';

export function registerDbExportCommand(db: Command): void {
  db.command('export')
    .description('Export full Notion database to CSV.')
    .argument('<db-id>', 'Notion database ID or URL')
    .option('-o, --out <file>', 'Output CSV file path (stdout if omitted)')
    .action(async (rawId: string, cmdOpts: { out?: string }) => {
      try {
        const opts = db.optsWithGlobals<GlobalOptions>();
        const rawIdParsed = parseNotionId(rawId);
        const client = getClient(opts.token);

        // Resolve db ID to data source ID
        const dbId = await resolveDataSourceId(client, rawIdParsed);

        // Fetch all rows with pagination
        const allResults: Array<Record<string, unknown>> = [];
        let cursor: string | undefined;
        let hasMore = true;

        while (hasMore) {
          const response: QueryDataSourceResponse = await withRateLimit(
            () =>
              client.dataSources.query({
                data_source_id: dbId,
                page_size: 100,
                start_cursor: cursor,
              }),
            'dataSources.query',
          );

          allResults.push(...(response.results as Array<Record<string, unknown>>));
          hasMore = response.has_more;
          cursor = response.next_cursor ?? undefined;
          logger.debug(`Fetched ${String(allResults.length)} rows so far...`);
        }

        // Extract property names
        const propertyNames = allResults.length > 0
          ? Object.keys(
              (allResults[0]?.['properties'] as Record<string, unknown> | undefined) ?? {},
            )
          : [];

        // Generate CSV
        const csv = rowsToCsv(
          allResults as Array<Record<string, unknown> & { id: string; properties: Record<string, Record<string, unknown>> }>,
          propertyNames,
        );

        // Write output
        if (cmdOpts.out !== undefined) {
          writeFileSync(cmdOpts.out, csv, 'utf-8');
          printSuccess({
            databaseId: dbId,
            file: cmdOpts.out,
            rowCount: allResults.length,
            columns: propertyNames,
          });
          logger.success(`Exported ${String(allResults.length)} rows to ${cmdOpts.out}`);
        } else {
          process.stdout.write(csv);
        }
      } catch (err) {
        const cliErr = toCliError(err);
        printError(cliErr.code, cliErr.message);
        process.exitCode = cliErr.exitCode;
      }
    });
}
