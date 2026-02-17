/**
 * notion-cli db delete <db-id> --ids <id1,id2,...>
 *
 * Archive (soft-delete) pages in a Notion database by their page IDs.
 *
 * This command is NOT idempotent (archives pages each run).
 */

import { type Command } from 'commander';
import { getClient, resolveDataSourceId } from '../../lib/client.js';
import { printSuccess, printError, isJsonMode } from '../../lib/output.js';
import { isDryRun } from '../../lib/safety.js';
import { withRetry } from '../../lib/rate-limit.js';
import { parseNotionId } from '../../utils/id.js';
import { type GlobalOptions } from '../../lib/types.js';
import { toCliError, ValidationError } from '../../lib/errors.js';
import * as logger from '../../utils/logger.js';

export function registerDbDeleteCommand(db: Command): void {
  db.command('delete')
    .description('Archive (delete) pages from a Notion database by page IDs.')
    .argument('<db-id>', 'Notion database ID or URL')
    .requiredOption(
      '--ids <ids>',
      'Comma-separated list of page IDs or URLs to archive',
    )
    .action(async (rawId: string, cmdOpts: { ids: string }) => {
      try {
        const opts = db.optsWithGlobals<GlobalOptions>();
        const rawIdParsed = parseNotionId(rawId);
        const client = getClient(opts.token);

        const dbId = await resolveDataSourceId(client, rawIdParsed);

        const pageIds = cmdOpts.ids
          .split(',')
          .map((id) => id.trim())
          .filter((id) => id.length > 0)
          .map(parseNotionId);

        if (pageIds.length === 0) {
          throw new ValidationError('No page IDs provided. Use --ids <id1,id2,...>.');
        }

        logger.info(`Delete: ${String(pageIds.length)} pages to archive.`);

        if (isDryRun(opts.dryRun)) {
          if (isJsonMode()) {
            printSuccess({
              databaseId: dbId,
              toArchive: pageIds.length,
              pageIds,
              dryRun: true,
            });
          } else {
            logger.info(
              `Dry run: Would archive ${String(pageIds.length)} pages from database ${dbId}.`,
            );
          }
          return;
        }

        let archived = 0;
        let failed = 0;

        for (const pageId of pageIds) {
          try {
            await withRetry(
              () => client.pages.update({ page_id: pageId, archived: true }),
              'pages.update (archive)',
            );
            archived++;
          } catch (err) {
            failed++;
            logger.warn(`Failed to archive page ${pageId}: ${String(err)}`);
          }
        }

        const result = {
          databaseId: dbId,
          archived,
          failed,
          total: pageIds.length,
        };

        if (isJsonMode()) {
          printSuccess(result);
        } else {
          logger.success(
            `Delete complete: ${String(archived)} archived, ${String(failed)} failed.`,
          );
        }
      } catch (err) {
        const cliErr = toCliError(err);
        printError(cliErr.code, cliErr.message);
        process.exitCode = cliErr.exitCode;
      }
    });
}
