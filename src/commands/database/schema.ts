/**
 * notion-cli db schema <db-id>
 *
 * Show the property schema of a Notion database.
 * Useful for constructing filter/sort queries and understanding available columns.
 *
 * This command is idempotent and read-only.
 */

import { type Command } from 'commander';
import { getClient, resolveDataSourceId } from '../../lib/client.js';
import { printSuccess, printError, formatTable, isJsonMode } from '../../lib/output.js';
import { withRateLimit } from '../../lib/rate-limit.js';
import { parseNotionId } from '../../utils/id.js';
import { type GlobalOptions, type DbSchema, type DbPropertySchema } from '../../lib/types.js';
import { toCliError } from '../../lib/errors.js';
import { isFullDataSource } from '@notionhq/client';
import type { GetDataSourceResponse } from '@notionhq/client/build/src/api-endpoints.js';

export function registerDbSchemaCommand(db: Command): void {
  db.command('schema')
    .description('Show database property schema.')
    .argument('<db-id>', 'Notion database ID or URL')
    .action(async (rawId: string) => {
      try {
        const opts = db.optsWithGlobals<GlobalOptions>();
        const rawIdParsed = parseNotionId(rawId);
        const client = getClient(opts.token);

        // Resolve db ID to data source ID
        const dbId = await resolveDataSourceId(client, rawIdParsed);

        const dataSource: GetDataSourceResponse = await withRateLimit(
          () => client.dataSources.retrieve({ data_source_id: dbId }),
          'dataSources.retrieve',
        );

        let title = 'Untitled';
        if (isFullDataSource(dataSource) && dataSource.title.length > 0) {
          const firstTitle = dataSource.title[0];
          if (firstTitle !== undefined) {
            title = firstTitle.plain_text;
          }
        }

        const props = dataSource.properties;
        const properties: DbPropertySchema[] = Object.entries(props).map(
          ([name, prop]) => {
            const { type } = prop;
            let options: string[] | undefined;

            // Extract select/multi_select/status options
            if (prop.type === 'select') {
              options = prop.select.options.map((o) => o.name);
            } else if (prop.type === 'multi_select') {
              options = prop.multi_select.options.map((o) => o.name);
            } else if (prop.type === 'status') {
              options = prop.status.options.map((o) => o.name);
            }

            return { name, type, options };
          },
        );

        const schema: DbSchema = {
          databaseId: dbId,
          title,
          properties,
        };

        if (isJsonMode()) {
          printSuccess(schema);
        } else {
          process.stdout.write(`Database: ${title}\n\n`);
          const tableRows: Array<readonly [string, string]> = properties.map((p) => {
            const opts = p.options !== undefined ? ` [${p.options.join(', ')}]` : '';
            return [p.name, `${p.type}${opts}`] as const;
          });
          process.stdout.write(`${formatTable(tableRows)}\n`);
        }
      } catch (err) {
        const cliErr = toCliError(err);
        printError(cliErr.code, cliErr.message);
        process.exitCode = cliErr.exitCode;
      }
    });
}
