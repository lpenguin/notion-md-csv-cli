/**
 * Notion API client singleton with token resolution.
 */

import { Client, APIResponseError, APIErrorCode, isFullDatabase } from '@notionhq/client';
import { resolveToken } from './config.js';
import * as logger from '../utils/logger.js';
import { withRateLimit } from './rate-limit.js';

let clientInstance: Client | undefined;

/**
 * Get or create the Notion API client.
 * Token is resolved from CLI flag → env → config file.
 */
export function getClient(cliToken?: string): Client {
  if (clientInstance !== undefined) {
    return clientInstance;
  }

  const token = resolveToken(cliToken);
  logger.debug('Initializing Notion API client.');

  clientInstance = new Client({
    auth: token,
    timeoutMs: 30_000,
  });

  return clientInstance;
}

/**
 * Resolve a database ID to its primary data source ID.
 * In the new Notion API (2025-09-03+), we must query data sources, not databases directly.
 */
export async function resolveDataSourceId(client: Client, dbId: string): Promise<string> {
  try {
    // We attempt to retrieve as a database first
    const db = await withRateLimit(
      () => client.databases.retrieve({ database_id: dbId }),
      'databases.retrieve',
    );

    // Check if the database has data_sources (new API)
    if (isFullDatabase(db) && db.data_sources.length > 0) {
      const firstDataSource = db.data_sources[0];
      if (firstDataSource !== undefined) {
        return firstDataSource.id;
      }
    }
  } catch (err: unknown) {
    // If retrieve fails with 404, it might already be a data_source ID (which databases.retrieve won't find)
    if (APIResponseError.isAPIResponseError(err) && err.code === APIErrorCode.ObjectNotFound) {
      try {
        const ds = await withRateLimit(
          // @ts-ignore - dataSources might be new in the SDK
          () => client.dataSources.retrieve({ data_source_id: dbId }),
          'dataSources.retrieve',
        );
        return ds.id;
      } catch {
        // Fallback to original ID if all else fails
        return dbId;
      }
    }
    throw err;
  }
  return dbId;
}

/** Reset client (useful for testing). */
export function resetClient(): void {
  clientInstance = undefined;
}
