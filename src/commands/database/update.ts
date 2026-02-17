/**
 * notion-cli db update <db-id> --file <file.csv>
 *
 * Update existing pages in a Notion database from CSV rows.
 * All rows must have a _notion_id column value.
 *
 * This command is NOT idempotent (applies updates each run).
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
import { isFullPage, type UpdatePageParameters, type PageObjectResponse } from '@notionhq/client';

export function registerDbUpdateCommand(db: Command): void {
  db.command('update')
    .description('Update existing pages in a Notion database from CSV rows.')
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

        const rowsWithoutId = rows.filter((r) => r.id === undefined);
        if (rowsWithoutId.length > 0) {
          throw new ValidationError(
            `All rows must have a _notion_id. Found ${String(rowsWithoutId.length)} row(s) without _notion_id. Use "db insert" for new rows.`,
          );
        }

        const dataSource = await withRetry(
          () => client.dataSources.retrieve({ data_source_id: dbId }),
          'dataSources.retrieve',
        );
        const schemaProps = dataSource.properties;

        logger.info(`Update: ${String(rows.length)} rows to update.`);

        if (isDryRun(opts.dryRun)) {
          if (isJsonMode()) {
            printSuccess({
              databaseId: dbId,
              toUpdate: rows.length,
              dryRun: true,
            });
          } else {
            logger.info(
              `Dry run: Would update ${String(rows.length)} rows in database ${dbId}.`,
            );
          }
          return;
        }

        let updated = 0;
        let failed = 0;

        for (const row of rows) {
          try {
            const csvProperties = buildNotionProperties(row.properties, schemaProps);

            // Fetch existing page properties for merge
            const pageResponse = await withRetry(
              () => client.pages.retrieve({ page_id: row.id ?? '' }),
              'pages.retrieve',
            );

            let existingProperties: PageObjectResponse['properties'] = {};
            if (isFullPage(pageResponse)) {
              existingProperties = pageResponse.properties;
            }

            // Merge: existing properties as base, CSV values overwrite
            const mergedProperties: Record<string, unknown> = {
              ...existingProperties,
              ...csvProperties,
            };

            await withRetry(
              () =>
                client.pages.update({
                  page_id: row.id ?? '',
                  properties: mergedProperties as UpdatePageParameters['properties'],
                }),
              'pages.update',
            );
            updated++;
          } catch (err) {
            failed++;
            logger.warn(`Failed to update row ${row.id ?? 'unknown'}: ${String(err)}`);
          }
        }

        const result = {
          databaseId: dbId,
          updated,
          failed,
          total: rows.length,
        };

        if (isJsonMode()) {
          printSuccess(result);
        } else {
          logger.success(
            `Update complete: ${String(updated)} updated, ${String(failed)} failed.`,
          );
        }
      } catch (err) {
        const cliErr = toCliError(err);
        printError(cliErr.code, cliErr.message);
        process.exitCode = cliErr.exitCode;
      }
    });
}
