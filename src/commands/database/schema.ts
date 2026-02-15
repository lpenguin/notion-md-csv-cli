/**
 * notion-cli db schema <db-id>
 *
 * Show the property schema of a Notion database.
 * Useful for constructing filter/sort queries and understanding available columns.
 *
 * This command is idempotent and read-only.
 */

import { type Command } from 'commander';
import { getClient } from '../../lib/client.js';
import { printSuccess, printError, formatTable, isJsonMode } from '../../lib/output.js';
import { withRetry } from '../../lib/rate-limit.js';
import { parseNotionId } from '../../utils/id.js';
import { type GlobalOptions, type DbSchema, type DbPropertySchema } from '../../lib/types.js';
import { toCliError } from '../../lib/errors.js';

export function registerDbSchemaCommand(db: Command): void {
  db.command('schema')
    .description('Show database property schema.')
    .argument('<db-id>', 'Notion database ID or URL')
    .action(async (rawId: string) => {
      try {
        const opts = db.optsWithGlobals<GlobalOptions>();
        const dbId = parseNotionId(rawId);
        const client = getClient(opts.token);

        const database = await withRetry(
          () => client.databases.retrieve({ database_id: dbId }),
          'databases.retrieve',
        );

        const dbObj = database as Record<string, unknown>;
        const titleArr = dbObj['title'] as Array<Record<string, unknown>> | undefined;
        let title = 'Untitled';
        if (titleArr !== undefined && titleArr.length > 0) {
          title = (titleArr[0]?.['plain_text'] as string | undefined) ?? 'Untitled';
        }

        const props = dbObj['properties'] as Record<string, Record<string, unknown>>;
        const properties: DbPropertySchema[] = Object.entries(props).map(
          ([name, prop]) => {
            const type = prop['type'] as string;
            let options: string[] | undefined;

            // Extract select/multi_select/status options
            if (type === 'select' || type === 'multi_select' || type === 'status') {
              const typeProp = prop[type] as Record<string, unknown> | undefined;
              const optionsArr = typeProp?.['options'] as
                | Array<Record<string, unknown>>
                | undefined;
              if (optionsArr !== undefined) {
                options = optionsArr.map(
                  (o) => (o['name'] as string | undefined) ?? '',
                );
              }
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
