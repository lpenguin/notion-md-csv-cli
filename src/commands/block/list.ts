/**
 * notion-cli block list <block-id>
 *
 * List child blocks of a Notion block or page.
 * Outputs JSON block objects.
 *
 * This command is idempotent and read-only.
 */

import { type Command } from 'commander';
import { getClient } from '../../lib/client.js';
import { printSuccess, printError } from '../../lib/output.js';
import { withRetry } from '../../lib/rate-limit.js';
import { parseNotionId } from '../../utils/id.js';
import { type GlobalOptions } from '../../lib/types.js';
import { toCliError } from '../../lib/errors.js';

export function registerBlockListCommand(block: Command): void {
  block
    .command('list')
    .description('List child blocks of a block or page as JSON.')
    .argument('<block-id>', 'Notion block or page ID')
    .option('-l, --limit <n>', 'Maximum blocks to return', '100')
    .option('--cursor <cursor>', 'Pagination cursor')
    .action(
      async (
        rawId: string,
        cmdOpts: { limit?: string; cursor?: string },
      ) => {
        try {
          const opts = block.optsWithGlobals<GlobalOptions>();
          const blockId = parseNotionId(rawId);
          const client = getClient(opts.token);

          const limit = parseInt(cmdOpts.limit ?? '100', 10);
          const response = await withRetry(
            () =>
              client.blocks.children.list({
                block_id: blockId,
                page_size: Math.min(limit, 100),
                start_cursor: cmdOpts.cursor,
              }),
            'blocks.children.list',
          );

          printSuccess(
            { blocks: response.results },
            {
              hasMore: response.has_more,
              cursor: response.next_cursor ?? undefined,
              totalCount: response.results.length,
            },
          );
        } catch (err) {
          const cliErr = toCliError(err);
          printError(cliErr.code, cliErr.message);
          process.exitCode = cliErr.exitCode;
        }
      },
    );
}
