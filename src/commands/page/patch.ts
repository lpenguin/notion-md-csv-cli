/**
 * notion-cli page patch <page-id> [options]
 *
 * Partially edit a Notion page's Markdown content.
 * Designed for AI agents / coding agents that need to make targeted edits.
 *
 * Line-range replacement (--lines START:END):
 *    notion-cli page patch <id> --lines 5:12 --content "new content"
 *    notion-cli page patch <id> --lines 5:12 --file patch.md
 *
 * Workflow (surgical patching):
 * 1. Fetch page as MdBlocks (preserving block IDs)
 * 2. Build block-to-line mapping
 * 3. Compute which blocks need to be deleted/inserted
 * 4. Apply changes surgically (only affected blocks)
 *
 * This command is NOT idempotent.
 */

import { type Command } from 'commander';
import { readFileSync } from 'node:fs';
import { getClient } from '../../lib/client.js';
import { fetchPageMdBlocks, markdownToNotionBlocks } from '../../lib/markdown.js';
import { buildBlockLineMap, computePatchPlan } from '../../lib/block-patch.js';
import { applyPatchOperation } from '../../lib/patch.js';
import { printSuccess, printError, isJsonMode } from '../../lib/output.js';
import { isDryRun, showDiffPreview } from '../../lib/safety.js';
import { withRetry } from '../../lib/rate-limit.js';
import { parseNotionId } from '../../utils/id.js';
import { lineRangeSchema } from '../../lib/validator.js';
import { unescapeString, dedentMarkdown } from '../../utils/string.js';
import { type GlobalOptions, type PatchOperation, type PagePatchResult } from '../../lib/types.js';
import { toCliError, ValidationError } from '../../lib/errors.js';
import * as logger from '../../utils/logger.js';

export function registerPagePatchCommand(page: Command): void {
  page
    .command('patch', { hidden: true })
    .description(
      'Partially edit a Notion page using line-range replacement.',
    )
    .argument('<page-id>', 'Notion page ID or URL')
    .option('--lines <range>', 'Line range to replace (e.g., "192:256")')
    .option('-f, --file <path>', 'Path to content file')
    .option('--content <text>', 'Inline content for replacement')
    .action(
      async (
        rawId: string,
        cmdOpts: {
          lines?: string;
          file?: string;
          content?: string;
        },
      ) => {
        try {
          const opts = page.optsWithGlobals<GlobalOptions>();
          const pageId = parseNotionId(rawId);
          const client = getClient(opts.token);

          // 1. Parse patch operation
          const operation = resolvePatchOperation(cmdOpts);

          // 2. Fetch page as MdBlocks (preserving block IDs)
          logger.info('Fetching current page content...');
          const mdBlocks = await withRetry(
            () => fetchPageMdBlocks(client, pageId),
            'fetchPageMdBlocks',
          );

          // 3. Build block-to-line mapping
          const { markdown: original, mappings } = buildBlockLineMap(mdBlocks);
          logger.debug(`Built mapping for ${String(mappings.length)} blocks.`);

          // 4. Apply text patch to get new content and diff
          const patchResult = applyPatchOperation(original, operation);

          logger.debug(`${String(patchResult.linesChanged)} lines changed.`);

          // 5. Compute surgical patch plan
          const plan = computePatchPlan(
            mappings,
            operation.start,
            operation.end,
            operation.content,
          );

          logger.debug(`Patch plan: delete ${String(plan.blocksToDelete.length)} blocks, insert ${String(plan.blocksToInsert.length)} segment(s).`);

          // 7. Dry run check
          if (isDryRun(opts.dryRun)) {
            const result: PagePatchResult = {
              pageId,
              linesChanged: patchResult.linesChanged,
              diff: patchResult.diff,
            };

            if (isJsonMode()) {
              printSuccess({
                ...result,
                dryRun: true,
                plan: {
                  blocksToDelete: plan.blocksToDelete.length,
                  blocksToInsert: plan.blocksToInsert.length,
                },
              });
            } else {
              showDiffPreview(original, patchResult.patched);
              logger.info(
                `Dry run: Would delete ${String(plan.blocksToDelete.length)} blocks and insert ${String(plan.blocksToInsert.length)} segment(s).`,
              );
            }
            return;
          }

          // 8. Execute surgical patch
          // Delete affected blocks
          for (const blockId of plan.blocksToDelete) {
            logger.debug(`Deleting block ${blockId}`);
            await withRetry(
              () => client.blocks.delete({ block_id: blockId }),
              'blocks.delete',
            );
          }

          // Insert new blocks
          for (const insert of plan.blocksToInsert) {
            // When inserting as children of a parent block, strip the
            // cosmetic indentation so that @tryfabric/martian does not
            // misinterpret indented list items as code blocks.
            const rawMd = insert.parentBlockId !== undefined
              ? dedentMarkdown(insert.markdown)
              : insert.markdown;
            const newBlocks = markdownToNotionBlocks(rawMd);
            const targetBlockId = insert.parentBlockId ?? pageId;

            // Append in chunks of 100
            for (let i = 0; i < newBlocks.length; i += 100) {
              const chunk = newBlocks.slice(i, i + 100);
              logger.debug(
                `Inserting ${String(chunk.length)} blocks after ${insert.afterId ?? 'start'}${
                  insert.parentBlockId !== undefined ? ` (as children of ${insert.parentBlockId})` : ''
                }`,
              );

              await withRetry(
                () =>
                  client.blocks.children.append({
                    block_id: targetBlockId,
                    children: chunk,
                    ...(insert.afterId !== null ? { after: insert.afterId } : {}),
                  }),
                'blocks.children.append',
              );
            }
          }

          const result: PagePatchResult = {
            pageId,
            linesChanged: patchResult.linesChanged,
            diff: patchResult.diff,
          };

          if (isJsonMode()) {
            printSuccess(result);
          } else {
            showDiffPreview(original, patchResult.patched);
            logger.success(
              `Patched page ${pageId} (${String(patchResult.linesChanged)} lines changed, ${String(plan.blocksToDelete.length)} blocks affected).`,
            );
          }
        } catch (err) {
          const cliErr = toCliError(err);
          printError(cliErr.code, cliErr.message);
          process.exitCode = cliErr.exitCode;
        }
      },
    );
}

/**
 * Determine the patch operation from command options.
 */
function resolvePatchOperation(cmdOpts: {
  lines?: string;
  file?: string;
  content?: string;
}): PatchOperation {
  if (cmdOpts.lines === undefined) {
    throw new ValidationError(
      'Missing --lines option. Example: --lines 192:256',
    );
  }

  const range = lineRangeSchema.parse(cmdOpts.lines);
  const content = resolveContentSync(cmdOpts.file, cmdOpts.content);
  return {
    mode: 'lines',
    start: range.start,
    end: range.end,
    content,
  };
}

function resolveContentSync(filePath?: string, inlineContent?: string): string {
  if (filePath !== undefined) {
    return readFileSync(filePath, 'utf-8');
  }
  if (inlineContent !== undefined) {
    return unescapeString(inlineContent);
  }
  throw new ValidationError(
    'No content provided for patch. Use --file or --content.',
  );
}
