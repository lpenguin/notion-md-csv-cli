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
import { getClient } from '../../lib/client.js';
import { csvToRows, buildPropertyValue } from '../../lib/csv.js';
import { printSuccess, printError, isJsonMode } from '../../lib/output.js';
import { isDryRun } from '../../lib/safety.js';
import { withRetry } from '../../lib/rate-limit.js';
import { parseNotionId } from '../../utils/id.js';
import { type GlobalOptions } from '../../lib/types.js';
import { toCliError, ValidationError } from '../../lib/errors.js';
import * as logger from '../../utils/logger.js';

export function registerDbImportCommand(db: Command): void {
  db.command('import')
    .description('Import CSV rows into a Notion database.')
    .argument('<db-id>', 'Notion database ID or URL')
    .requiredOption('-f, --file <path>', 'Path to CSV file')
    .action(async (rawId: string, cmdOpts: { file: string }) => {
      try {
        const opts = db.optsWithGlobals<GlobalOptions>();
        const dbId = parseNotionId(rawId);
        const client = getClient(opts.token);

        // Read and parse CSV
        const csvContent = readFileSync(cmdOpts.file, 'utf-8');
        const rows = csvToRows(csvContent);

        if (rows.length === 0) {
          throw new ValidationError('CSV file contains no data rows.');
        }

        // Fetch database schema to know property types
        const dbSchema = await withRetry(
          () => client.databases.retrieve({ database_id: dbId }),
          'databases.retrieve',
        );
        const schemaProps = (dbSchema as Record<string, unknown>)['properties'] as Record<
          string,
          Record<string, unknown>
        >;

        const toCreate = rows.filter((r) => r.id === undefined);
        const toUpdate = rows.filter((r) => r.id !== undefined);

        logger.info(
          `Import: ${String(toCreate.length)} new rows, ${String(toUpdate.length)} updates.`,
        );

        if (isDryRun(opts.dryRun)) {
          if (isJsonMode()) {
            printSuccess({
              databaseId: dbId,
              toCreate: toCreate.length,
              toUpdate: toUpdate.length,
              dryRun: true,
            });
          } else {
            logger.info(
              `Dry run: Would import ${String(rows.length)} rows into database ${dbId} (${String(toCreate.length)} new, ${String(toUpdate.length)} updates).`,
            );
          }
          return;
        }

        let created = 0;
        let updated = 0;
        let failed = 0;

        // Create new pages
        for (const row of toCreate) {
          try {
            const properties = buildNotionProperties(row.properties, schemaProps);
            await withRetry(
              () =>
                client.pages.create({
                  parent: { database_id: dbId },
                  properties: properties as Parameters<typeof client.pages.create>[0]['properties'],
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
          failed,
          total: rows.length,
        };

        if (isJsonMode()) {
          printSuccess(result);
        } else {
          logger.success(
            `Import complete: ${String(created)} created, ${String(updated)} updated, ${String(failed)} failed.`,
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
