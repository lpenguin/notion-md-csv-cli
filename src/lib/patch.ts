/**
 * Patch engine — apply edits to Markdown content.
 *
 * Three modes designed for AI agent workflows:
 *
 * 1. Line-range replacement (--lines START:END)
 *    Replace lines START through END with new content.
 *    Familiar to coding agents that work with line numbers.
 *
 * 2. Append / Prepend (--append / --prepend)
 *    Add content to the end or beginning of the page.
 */

import { createTwoFilesPatch } from 'diff';
import { type PatchOperation, type PatchLineRange, type PatchAppend, type PatchPrepend } from './types.js';
import { ValidationError } from './errors.js';
import * as logger from '../utils/logger.js';

/** Result of applying a patch. */
export interface PatchResult {
  /** The patched Markdown content. */
  readonly patched: string;
  /** Human-readable unified diff of the changes. */
  readonly diff: string;
  /** Number of lines changed. */
  readonly linesChanged: number;
}

/**
 * Apply a patch operation to Markdown content.
 * Returns the patched content, a diff of changes, and line count.
 */
export function applyPatchOperation(
  original: string,
  operation: PatchOperation,
): PatchResult {
  switch (operation.mode) {
    case 'lines':
      return applyLineRange(original, operation);
    case 'append':
      return applyAppend(original, operation);
    case 'prepend':
      return applyPrepend(original, operation);
  }
}

/**
 * Mode 1: Line-range replacement.
 *
 * Replace lines [start, end] (1-indexed, inclusive) with new content.
 *
 * Special cases:
 * - start === end: Replace a single line.
 * - end === Infinity: Replace from start to end of file.
 * - Content is empty: Delete the lines.
 * - start > total lines: Append at end.
 */
function applyLineRange(original: string, op: PatchLineRange): PatchResult {
  const lines = original.split('\n');
  const totalLines = lines.length;

  // Validate range
  if (op.start < 1) {
    throw new ValidationError('Line range start must be >= 1.');
  }

  const effectiveEnd = op.end === Infinity ? totalLines : Math.min(op.end, totalLines);

  if (op.start > totalLines + 1) {
    throw new ValidationError(
      `Start line ${String(op.start)} exceeds document length (${String(totalLines)} lines).`,
    );
  }

  logger.debug(
    `Replacing lines ${String(op.start)}-${String(effectiveEnd)} (of ${String(totalLines)}) with ${String(op.content.split('\n').length)} lines.`,
  );

  // Build new content
  const before = lines.slice(0, op.start - 1);
  const after = lines.slice(effectiveEnd);
  const newLines = op.content === '' ? [] : op.content.split('\n');
  const patched = [...before, ...newLines, ...after].join('\n');

  return buildResult(original, patched);
}

/**
 * Mode 2: Append content to the end of the document.
 */
function applyAppend(original: string, op: PatchAppend): PatchResult {
  logger.debug(`Appending ${String(op.content.length)} chars.`);
  const patched = original.endsWith('\n')
    ? `${original}${op.content}`
    : `${original}\n${op.content}`;
  return buildResult(original, patched);
}

/**
 * Mode 3: Prepend content to the beginning of the document.
 */
function applyPrepend(original: string, op: PatchPrepend): PatchResult {
  logger.debug(`Prepending ${String(op.content.length)} chars.`);
  const patched = `${op.content}\n${original}`;
  return buildResult(original, patched);
}

/**
 * Build a PatchResult from before/after content.
 */
function buildResult(original: string, patched: string): PatchResult {
  const diff = createTwoFilesPatch('before', 'after', original, patched, '', '', {
    context: 3,
  });

  // Count changed lines
  const diffLines = diff.split('\n');
  let added = 0;
  let removed = 0;
  for (const line of diffLines) {
    if (line.startsWith('+') && !line.startsWith('+++')) {
      added++;
    }
    if (line.startsWith('-') && !line.startsWith('---')) {
      removed++;
    }
  }

  return {
    patched,
    diff,
    linesChanged: added + removed,
  };
}
