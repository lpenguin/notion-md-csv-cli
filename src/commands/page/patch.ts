/**
 * notion-cli page patch <page-id> [options]
 *
 * Partially edit a Notion page's Markdown content.
 * Designed for AI agents / coding agents that need to make targeted edits.
 *
 * Patch modes:
 *
 * 1. Line-range replacement (--lines START:END):
 *    notion-cli page patch <id> --lines 5:12 --content "new content" -y
 *    notion-cli page patch <id> --lines 5:12 --file patch.md -y
 *
 * 2. Append (--append):
 *    notion-cli page patch <id> --append --content "extra content" -y
 *
 * 3. Prepend (--prepend):
 *    notion-cli page patch <id> --prepend --content "header content" -y
 *
 * Workflow:
 * 1. Fetch current page → Markdown
 * 2. Apply patch operation
 * 3. Show diff preview (skipped with -y in --json mode)
 * 4. Confirm (skipped with -y)
 * 5. Convert patched Markdown → Notion blocks (via martian)
 * 6. Replace page blocks
 *
 * Safety: Requires confirmation unless --yes is passed.
 * This command is NOT idempotent.
 */

import { type Command } from 'commander';
import { readFileSync } from 'node:fs';
import { getClient } from '../../lib/client.js';
import { notionPageToMarkdown, markdownToNotionBlocks } from '../../lib/markdown.js';
import { applyPatchOperation } from '../../lib/patch.js';
import { printSuccess, printError, isJsonMode } from '../../lib/output.js';
import { confirmAction, isDryRun, showDiffPreview } from '../../lib/safety.js';
import { withRetry } from '../../lib/rate-limit.js';
import { parseNotionId } from '../../utils/id.js';
import { lineRangeSchema } from '../../lib/validator.js';
import { unescapeString } from '../../utils/string.js';
import { type GlobalOptions, type PatchOperation, type PagePatchResult } from '../../lib/types.js';
import { toCliError, ValidationError } from '../../lib/errors.js';
import * as logger from '../../utils/logger.js';

export function registerPagePatchCommand(page: Command): void {
  page
    .command('patch')
    .description(
      'Partially edit a Notion page. Supports line-range, append, and prepend.',
    )
    .argument('<page-id>', 'Notion page ID or URL')
    .option('--lines <range>', 'Line range to replace (e.g., "5:12", "5:" for rest of file)')
    .option('--append', 'Append content to end of page')
    .option('--prepend', 'Prepend content to beginning of page')
    .option('-f, --file <path>', 'Path to content/patch file')
    .option('--content <text>', 'Inline content for replacement')
    .action(
      async (
        rawId: string,
        cmdOpts: {
          lines?: string;
          append?: boolean;
          prepend?: boolean;
          file?: string;
          content?: string;
        },
      ) => {
        try {
          const opts = page.optsWithGlobals<GlobalOptions>();
          const pageId = parseNotionId(rawId);
          const client = getClient(opts.token);

          // 1. Determine patch operation
          const operation = resolvePatchOperation(cmdOpts);

          // 2. Fetch current page content
          logger.info('Fetching current page content...');
          const original = await withRetry(
            () => notionPageToMarkdown(client, pageId),
            'pageToMarkdown',
          );

          // 3. Apply patch
          const result = applyPatchOperation(original, operation);

          // 4. Show diff preview (skip in json mode with -y)
          if (!isJsonMode() || opts.yes !== true) {
            showDiffPreview(original, result.patched);
          }

          logger.info(`${String(result.linesChanged)} lines changed.`);

          // 5. Dry run check
          if (isDryRun(opts.dryRun)) {
            const patchResult: PagePatchResult = {
              pageId,
              linesChanged: result.linesChanged,
              diff: result.diff,
            };
            printSuccess({ ...patchResult, dryRun: true });
            return;
          }

          // 6. Confirm
          const confirmed = await confirmAction(
            `Apply patch to page ${pageId}? (${String(result.linesChanged)} lines changed)`,
            opts.yes === true,
          );
          if (!confirmed) {
            logger.info('Aborted.');
            return;
          }

          // 7. Convert patched content to Notion blocks
          const blocks = markdownToNotionBlocks(result.patched);

          // 8. Replace page blocks
          // Delete all existing blocks
          const existingBlocks = await withRetry(
            () => client.blocks.children.list({ block_id: pageId, page_size: 100 }),
            'blocks.children.list',
          );

          for (const block of existingBlocks.results) {
            await withRetry(
              () => client.blocks.delete({ block_id: block.id }),
              'blocks.delete',
            );
          }

          // Handle pagination for existing blocks
          let hasMore = existingBlocks.has_more;
          let cursor: string | null = existingBlocks.next_cursor;
          while (hasMore && cursor !== null) {
            const more = await withRetry(
              () =>
                client.blocks.children.list({
                  block_id: pageId,
                  page_size: 100,
                  start_cursor: cursor ?? undefined,
                }),
              'blocks.children.list',
            );
            for (const block of more.results) {
              await withRetry(
                () => client.blocks.delete({ block_id: block.id }),
                'blocks.delete',
              );
            }
            hasMore = more.has_more;
            cursor = more.next_cursor;
          }

          // Append new blocks in chunks
          for (let i = 0; i < blocks.length; i += 100) {
            const chunk = blocks.slice(i, i + 100);
            await withRetry(
              () =>
                client.blocks.children.append({
                  block_id: pageId,
                  children: chunk,
                }),
              'blocks.children.append',
            );
          }

          const patchResult: PagePatchResult = {
            pageId,
            linesChanged: result.linesChanged,
            diff: result.diff,
          };

          printSuccess(patchResult);
          logger.success(`Patched page ${pageId} (${String(result.linesChanged)} lines changed).`);
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
  append?: boolean;
  prepend?: boolean;
  file?: string;
  content?: string;
}): PatchOperation {
  const modeCount = [
    cmdOpts.lines !== undefined,
    cmdOpts.append === true,
    cmdOpts.prepend === true,
  ].filter(Boolean).length;

  if (modeCount === 0) {
    throw new ValidationError(
      'No patch mode specified. Use --lines, --append, or --prepend.',
    );
  }
  if (modeCount > 1) {
    throw new ValidationError(
      'Multiple patch modes specified. Use only one of --lines, --append, --prepend.',
    );
  }

  // Mode: Line range
  if (cmdOpts.lines !== undefined) {
    const range = lineRangeSchema.parse(cmdOpts.lines);
    const content = resolveContentSync(cmdOpts.file, cmdOpts.content);
    return {
      mode: 'lines',
      start: range.start,
      end: range.end,
      content,
    };
  }

  // Mode: Append
  if (cmdOpts.append === true) {
    const content = resolveContentSync(cmdOpts.file, cmdOpts.content);
    return { mode: 'append', content };
  }

  // Mode: Prepend
  if (cmdOpts.prepend === true) {
    const content = resolveContentSync(cmdOpts.file, cmdOpts.content);
    return { mode: 'prepend', content };
  }

  throw new ValidationError('Unable to determine patch mode.');
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
