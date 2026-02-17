/**
 * notion-cli db insert <db-id> --file <file.csv>
 *
 * Insert CSV rows as new pages in a Notion database.
 * All rows must NOT have a _notion_id column value.
 *
 * This command is NOT idempotent (creates new pages each run).
 */

import { type Command } from 'commander';
import { readFileSync } from 'node:fs';
import { getClient, resolveDataSourceId } from '../../lib/client.js';
import { csvToRows } from '../../lib/csv.js';
import { buildNotionProperties } from '../../lib/db-properties.js';
import { printSuccess, printError, isJsonMode } from '../../lib/output.js';
import { isDryRun } from '../../lib/safety.js';
import { withRetry } from '../../lib/rate-limit.js';
import { parseNotionId } from '../../utils/id.js';
import { type GlobalOptions } from '../../lib/types.js';
import { toCliError, ValidationError } from '../../lib/errors.js';
import * as logger from '../../utils/logger.js';
import type { CreatePageParameters } from '@notionhq/client';

export function registerDbInsertCommand(db: Command): void {
  db.command('insert')
    .description('Insert CSV rows as new pages into a Notion database.')
    .argument('<db-id>', 'Notion database ID or URL')
    .requiredOption('-f, --file <path>', 'Path to CSV file')
    .action(async (rawId: string, cmdOpts: { file: string }) => {
      try {
        const opts = db.optsWithGlobals<GlobalOptions>();
        const rawIdParsed = parseNotionId(rawId);
        const client = getClient(opts.token);

        const dbId = await resolveDataSourceId(client, rawIdParsed);

        const csvContent = readFileSync(cmdOpts.file, 'utf-8');
        const rows = csvToRows(csvContent);

        if (rows.length === 0) {
          throw new ValidationError('CSV file contains no data rows.');
        }

        const rowsWithId = rows.filter((r) => r.id !== undefined);
        if (rowsWithId.length > 0) {
          throw new ValidationError(
            `All rows must be new (no _notion_id). Found ${String(rowsWithId.length)} row(s) with _notion_id. Use "db update" for existing rows.`,
          );
        }

        const dataSource = await withRetry(
          () => client.dataSources.retrieve({ data_source_id: dbId }),
          'dataSources.retrieve',
        );
        const schemaProps = dataSource.properties;

        logger.info(`Insert: ${String(rows.length)} new rows to create.`);

        if (isDryRun(opts.dryRun)) {
          if (isJsonMode()) {
            printSuccess({
              databaseId: dbId,
              toCreate: rows.length,
              dryRun: true,
            });
          } else {
            logger.info(
              `Dry run: Would insert ${String(rows.length)} new rows into database ${dbId}.`,
            );
          }
          return;
        }

        let created = 0;
        let failed = 0;

        for (const row of rows) {
          try {
            const properties = buildNotionProperties(row.properties, schemaProps);
            await withRetry(
              () =>
                client.pages.create({
                  parent: { database_id: rawIdParsed },
                  properties: properties as CreatePageParameters['properties'],
                }),
              'pages.create',
            );
            created++;
          } catch (err) {
            failed++;
            logger.warn(`Failed to create row: ${String(err)}`);
          }
        }

        const result = {
          databaseId: dbId,
          created,
          failed,
          total: rows.length,
        };

        if (isJsonMode()) {
          printSuccess(result);
        } else {
          logger.success(
            `Insert complete: ${String(created)} created, ${String(failed)} failed.`,
          );
        }
      } catch (err) {
        const cliErr = toCliError(err);
        printError(cliErr.code, cliErr.message);
        process.exitCode = cliErr.exitCode;
      }
    });
}
