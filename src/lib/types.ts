/**
 * Shared types for the Notion CLI.
 */

/** Standard JSON output envelope for AI agent consumption. */
export interface CliSuccessResponse<T = unknown> {
  readonly ok: true;
  readonly data: T;
  readonly meta?: ResponseMeta;
}

export interface CliErrorResponse {
  readonly ok: false;
  readonly error: {
    readonly code: string;
    readonly message: string;
    readonly details?: unknown;
  };
}

export type CliResponse<T = unknown> = CliSuccessResponse<T> | CliErrorResponse;

export interface ResponseMeta {
  readonly cursor?: string;
  readonly hasMore?: boolean;
  readonly totalCount?: number;
}

/** Exit codes mapped to error categories. */
export const ExitCode = {
  SUCCESS: 0,
  GENERAL_ERROR: 1,
  VALIDATION_ERROR: 2,
  AUTH_ERROR: 3,
  NOT_FOUND: 4,
  RATE_LIMITED: 5,
} as const;

export type ExitCodeValue = (typeof ExitCode)[keyof typeof ExitCode];

/** Global CLI options available on every command. */
export interface GlobalOptions {
  readonly json?: boolean;
  readonly token?: string;
  readonly dryRun?: boolean;
  readonly yes?: boolean;
  readonly verbose?: boolean;
}

/** Page read result. */
export interface PageReadResult {
  readonly pageId: string;
  readonly title: string;
  readonly markdown: string;
  readonly lastEditedTime: string;
}

/** Page write result. */
export interface PageWriteResult {
  readonly pageId: string;
  readonly blocksWritten: number;
}

/** Page patch result. */
export interface PagePatchResult {
  readonly pageId: string;
  readonly linesChanged: number;
  readonly diff: string;
}

/** Search result item. */
export interface SearchResultItem {
  readonly id: string;
  readonly type: 'page' | 'database';
  readonly title: string;
  readonly url: string;
  readonly lastEditedTime: string;
}

/** Search results. */
export interface SearchResults {
  readonly results: readonly SearchResultItem[];
  readonly hasMore: boolean;
  readonly nextCursor?: string;
}

/** Database schema property. */
export interface DbPropertySchema {
  readonly name: string;
  readonly type: string;
  readonly options?: readonly string[];
}

/** Database schema. */
export interface DbSchema {
  readonly databaseId: string;
  readonly title: string;
  readonly properties: readonly DbPropertySchema[];
}

/** Patch mode options. */
export interface PatchLineRange {
  readonly mode: 'lines';
  readonly start: number;
  readonly end: number;
  readonly content: string;
}

export interface PatchAppend {
  readonly mode: 'append';
  readonly content: string;
}

export interface PatchPrepend {
  readonly mode: 'prepend';
  readonly content: string;
}

export type PatchOperation = PatchLineRange | PatchAppend | PatchPrepend;

/** Config file shape. */
export interface CliConfig {
  readonly token?: string;
  readonly defaultDatabase?: string;
  readonly confirmBeforeWrite?: boolean;
}
