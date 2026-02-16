/**
 * notion-cli db import <db-id> --file <file.csv>
 *
 * Import CSV rows into a Notion database.
 * - Rows with _notion_id column: update existing pages.
 * - Rows without _notion_id: create new pages.
 *
 * This command is NOT idempotent (creates/updates pages).
 */

import { type Command } from 'commander';
import { readFileSync } from 'node:fs';
import { getClient, resolveDataSourceId } from '../../lib/client.js';
import { csvToRows, buildPropertyValue } from '../../lib/csv.js';
import { printSuccess, printError, isJsonMode } from '../../lib/output.js';
import { isDryRun } from '../../lib/safety.js';
import { withRetry } from '../../lib/rate-limit.js';
import { parseNotionId } from '../../utils/id.js';
import { type GlobalOptions } from '../../lib/types.js';
import { toCliError, ValidationError } from '../../lib/errors.js';
import * as logger from '../../utils/logger.js';
import type { GetDataSourceResponse } from '@notionhq/client/build/src/api-endpoints.js';

export function registerDbImportCommand(db: Command): void {
  db.command('import')
    .description('Import CSV rows into a Notion database.')
    .argument('<db-id>', 'Notion database ID or URL')
    .requiredOption('-f, --file <path>', 'Path to CSV file')
    .option('--sync', 'Sycnchronize database: ARCHIVE pages not present in CSV')
    .action(async (rawId: string, cmdOpts: { file: string; sync?: boolean }) => {
      try {
        const opts = db.optsWithGlobals<GlobalOptions>();
        const rawIdParsed = parseNotionId(rawId);
        const client = getClient(opts.token);

        // Resolve db ID to data source ID
        const dbId = await resolveDataSourceId(client, rawIdParsed);

        // Read and parse CSV
        const csvContent = readFileSync(cmdOpts.file, 'utf-8');
        const rows = csvToRows(csvContent);

        if (rows.length === 0) {
          throw new ValidationError('CSV file contains no data rows.');
        }

        // Fetch data source schema to know property types
        const dataSource: GetDataSourceResponse = await withRetry(
          () => (client as any).dataSources.retrieve({ data_source_id: dbId }),
          'dataSources.retrieve',
        );
        const schemaProps = (dataSource as any).properties as Record<
          string,
          Record<string, unknown>
        >;

        const toCreate = rows.filter((r) => r.id === undefined);
        const toUpdate = rows.filter((r) => r.id !== undefined);
        const csvIds = new Set(rows.map((r) => r.id).filter(Boolean));

        let toArchive: string[] = [];
        if (cmdOpts.sync) {
          logger.info('Sync mode enabled: fetching current pages from Notion for comparison...');
          let cursor: string | undefined;
          let hasMore = true;
          const notionIds: string[] = [];

          while (hasMore) {
            const response: any = await withRetry(
              () =>
                (client as any).dataSources.query({
                  data_source_id: dbId,
                  page_size: 100,
                  start_cursor: cursor,
                }),
              'dataSources.query',
            );
            notionIds.push(...response.results.map((r: any) => r.id));
            hasMore = response.has_more;
            cursor = response.next_cursor ?? undefined;
          }

          toArchive = notionIds.filter((id) => !csvIds.has(id));
        }

        logger.info(
          `Import: ${String(toCreate.length)} new rows, ${String(toUpdate.length)} updates, ${String(toArchive.length)} to archive.`,
        );

        if (isDryRun(opts.dryRun)) {
          if (isJsonMode()) {
            printSuccess({
              databaseId: dbId,
              toCreate: toCreate.length,
              toUpdate: toUpdate.length,
              toArchive: toArchive.length,
              dryRun: true,
            });
          } else {
            logger.info(
              `Dry run: Would import ${String(rows.length)} rows into database ${dbId} (${String(toCreate.length)} new, ${String(toUpdate.length)} updates, ${String(toArchive.length)} archive).`,
            );
          }
          return;
        }

        let created = 0;
        let updated = 0;
        let archived = 0;
        let failed = 0;

        // Archive pages NOT in CSV (Sync mode)
        for (const pageId of toArchive) {
          try {
            await withRetry(
              () => client.pages.update({ page_id: pageId, archived: true }),
              'pages.update (archive)',
            );
            archived++;
          } catch (err) {
            failed++;
            logger.warn(`Failed to archive row ${pageId}: ${String(err)}`);
          }
        }

        // Create new pages
        for (const row of toCreate) {
          try {
            const properties = buildNotionProperties(row.properties, schemaProps);
            const parentKey = (dataSource as any).parent?.type === 'data_source_id' ? 'data_source_id' : 'database_id';
            // Even if we query via data_source, we should try creating via database_id first 
            // as pages.create might not support data_source_id yet in some versions/cases.
            // But let's first check if rawIdParsed (the original ID) works as database_id.
            await withRetry(
              () =>
                client.pages.create({
                  parent: { database_id: rawIdParsed } as any,
                  properties: properties as any,
                }),
              'pages.create',
            );
            created++;
          } catch (err) {
            failed++;
            logger.warn(`Failed to create row: ${String(err)}`);
          }
        }

        // Update existing pages
        for (const row of toUpdate) {
          try {
            const properties = buildNotionProperties(row.properties, schemaProps);
            await withRetry(
              () =>
                client.pages.update({
                  page_id: row.id ?? '',
                  properties: properties as Parameters<typeof client.pages.update>[0]['properties'],
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
          created,
          updated,
          archived,
          failed,
          total: rows.length,
        };

        if (isJsonMode()) {
          printSuccess(result);
        } else {
          logger.success(
            `Import complete: ${String(created)} created, ${String(updated)} updated, ${String(archived)} archived, ${String(failed)} failed.`,
          );
        }
      } catch (err) {
        const cliErr = toCliError(err);
        printError(cliErr.code, cliErr.message);
        process.exitCode = cliErr.exitCode;
      }
    });
}

/**
 * Build Notion page properties from CSV values + schema.
 */
function buildNotionProperties(
  csvProps: Record<string, string>,
  schema: Record<string, Record<string, unknown>>,
): Record<string, unknown> {
  const properties: Record<string, unknown> = {};

  for (const [name, value] of Object.entries(csvProps)) {
    const propSchema = schema[name];
    if (propSchema === undefined) {
      logger.warn(`Property "${name}" not found in database schema. Skipping.`);
      continue;
    }

    const type = propSchema['type'] as string;
    const notionValue = buildPropertyValue(type, value);
    if (notionValue !== undefined) {
      properties[name] = notionValue;
    }
  }

  return properties;
}
