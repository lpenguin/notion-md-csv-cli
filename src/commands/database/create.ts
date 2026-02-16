/**
 * notion-cli db create
 *
 * Create a new Notion database in a parent page.
 */

import { type Command } from 'commander';
import { getClient } from '../../lib/client.js';
import { printSuccess, printError, isJsonMode } from '../../lib/output.js';
import { withRetry } from '../../lib/rate-limit.js';
import { parseNotionId } from '../../utils/id.js';
import { type GlobalOptions } from '../../lib/types.js';
import { toCliError } from '../../lib/errors.js';
import * as logger from '../../utils/logger.js';
import type {
  DatabaseObjectResponse,
  CreateDataSourceParameters,
} from '@notionhq/client/build/src/api-endpoints.js';

export function registerDbCreateCommand(db: Command): void {
  db.command('create')
    .description('Create a new database.')
    .requiredOption('-p, --parent <id>', 'Parent page ID')
    .requiredOption('-t, --title <text>', 'Database title')
    .option(
      '-s, --schema <json>',
      'Database schema (Notion properties JSON)',
      '{"Name": {"title": {}}}',
    )
    .action(async (cmdOpts: { parent: string; title: string; schema: string }) => {
      try {
        const opts = db.optsWithGlobals<GlobalOptions>();
        const parentId = parseNotionId(cmdOpts.parent);
        const client = getClient(opts.token);

        let properties: Record<string, unknown>;
        try {
          properties = JSON.parse(cmdOpts.schema) as Record<string, unknown>;
        } catch (err) {
          throw new Error(`Invalid schema JSON: ${(err as Error).message}`);
        }

        if (opts.dryRun === true) {
          logger.info(`[Dry Run] Would create database "${cmdOpts.title}" in page ${parentId}`);
          if (isJsonMode()) {
            printSuccess({ dryRun: true, parentId, title: cmdOpts.title, properties });
          }
          return;
        }

        const response = (await withRetry(
          () =>
            client.databases.create({
              parent: {
                type: 'page_id',
                page_id: parentId,
              },
              title: [
                {
                  type: 'text',
                  text: {
                    content: cmdOpts.title,
                  },
                },
              ],
              initial_data_source: {
                properties: properties as CreateDataSourceParameters['properties'],
              },
            }),
          'databases.create',
        )) as DatabaseObjectResponse;

        if (isJsonMode()) {
          printSuccess(response);
        } else {
          logger.info(`Database created successfully: ${response.id}`);
          process.stdout.write(`URL: ${response.url}\n`);
        }
      } catch (err) {
        const cliErr = toCliError(err);
        printError(cliErr.code, cliErr.message);
        process.exitCode = cliErr.exitCode;
      }
    });
}
