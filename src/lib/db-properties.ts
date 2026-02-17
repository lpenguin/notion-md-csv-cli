/**
 * Shared helper to build Notion page properties from CSV values + database schema.
 * Used by both `db insert` and `db update` commands.
 */

import type { GetDataSourceResponse } from '@notionhq/client';
import { buildPropertyValue } from './csv.js';
import * as logger from '../utils/logger.js';

export type SchemaProperties = GetDataSourceResponse['properties'];

/**
 * Build Notion page properties from CSV values + schema.
 */
export function buildNotionProperties(
  csvProps: Record<string, string>,
  schema: SchemaProperties,
): Record<string, unknown> {
  const properties: Record<string, unknown> = {};

  for (const [name, value] of Object.entries(csvProps)) {
    const propSchema = schema[name];
    if (propSchema === undefined) {
      logger.warn(`Property "${name}" not found in database schema. Skipping.`);
      continue;
    }

    const notionValue = buildPropertyValue(propSchema.type, value);
    if (notionValue !== undefined) {
      properties[name] = notionValue;
    }
  }

  return properties;
}
