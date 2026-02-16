/**
 * Safety module — confirmation prompts, dry-run, and write guards.
 *
 * This is the single point of control for write safety.
 */

import chalk from 'chalk';
import { createTwoFilesPatch } from 'diff';
import * as logger from '../utils/logger.js';

/**
 * Guard for dry-run mode.
 * Returns true if we should skip the actual write (dry-run is active).
 */
export function isDryRun(dryRun?: boolean): boolean {
  if (dryRun === true) {
    logger.info(chalk.cyan('[DRY RUN] No changes will be made.'));
    return true;
  }
  return false;
}

/**
 * Display a diff preview before applying changes.
 * 
 * Shows a colored unified diff of the changes.
 */
export function showDiffPreview(before: string, after: string): void {
  const diffHunk = buildDiffHunk(before, after);
  if (diffHunk === '') {
    process.stderr.write(chalk.gray('\nNo changes detected.\n\n'));
    return;
  }

  process.stderr.write(`\n${chalk.bold('Changes preview:')}\n`);
  
  const lines = diffHunk.split('\n');
  for (const line of lines) {
    if (line.startsWith('+') && !line.startsWith('+++')) {
      process.stderr.write(`${chalk.green(line)}\n`);
    } else if (line.startsWith('-') && !line.startsWith('---')) {
      process.stderr.write(`${chalk.red(line)}\n`);
    } else if (line.startsWith('@@')) {
      process.stderr.write(`${chalk.cyan(line)}\n`);
    } else if (line.startsWith('---') || line.startsWith('+++')) {
      // Skip file headers
    } else {
      process.stderr.write(` ${line}\n`);
    }
  }
  process.stderr.write('\n');
}

/**
 * Build a unified diff hunk with context.
 */
function buildDiffHunk(before: string, after: string): string {
  return createTwoFilesPatch('original', 'patched', before, after, '', '', {
    context: 3,
  });
}
