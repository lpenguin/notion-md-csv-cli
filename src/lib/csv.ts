/**
 * CSV conversion utilities for Notion database rows.
 *
 * - Notion DB rows → CSV (export)
 * - CSV → Notion DB row properties (import)
 *
 * Property type mapping:
 *   title, rich_text    → string
 *   number              → number
 *   select              → string
 *   multi_select        → semicolon-separated string
 *   date                → ISO string (start / start|end for ranges)
 *   checkbox            → "true" / "false"
 *   url, email, phone   → string
 *   formula             → computed string (read-only)
 *   relation            → comma-separated page IDs
 *   rollup              → computed string (read-only)
 *   status              → string
 *   people              → comma-separated user IDs
 *   files               → comma-separated URLs
 */

import { stringify } from 'csv-stringify/sync';
import { parse } from 'csv-parse/sync';
import * as logger from '../utils/logger.js';

// Using Record-based types to avoid dependency on Notion's complex nested types
type NotionPropertyValue = Record<string, unknown>;
type NotionPageResult = Record<string, unknown> & {
  id: string;
  properties: Record<string, NotionPropertyValue>;
};

/**
 * Convert Notion database query results to CSV string.
 */
export function rowsToCsv(
  rows: readonly NotionPageResult[],
  propertyNames: readonly string[],
): string {
  const headers = ['_notion_id', ...propertyNames];

  const records = rows.map((row) => {
    const record: Record<string, string> = { _notion_id: row.id };
    for (const prop of propertyNames) {
      const value = row.properties[prop];
      record[prop] = value !== undefined ? extractPropertyValue(value) : '';
    }
    return record;
  });

  return stringify(records, {
    header: true,
    columns: headers,
  });
}

/**
 * Parse CSV string into row objects for database import.
 * Returns an array of { id?: string, properties: Record<string, string> }.
 */
export function csvToRows(
  csvContent: string,
): Array<{ id?: string; properties: Record<string, string> }> {
  const records = parse(csvContent, {
    columns: true,
    skip_empty_lines: true,
    trim: true,
  }) as Array<Record<string, string>>;

  return records.map((record) => {
    const id = record['_notion_id'];
    const properties: Record<string, string> = {};

    for (const [key, value] of Object.entries(record)) {
      if (key !== '_notion_id') {
        properties[key] = value;
      }
    }

    return {
      id: id !== undefined && id !== '' ? id : undefined,
      properties,
    };
  });
}

/**
 * Build Notion property objects from CSV row values.
 * Maps string values back to Notion property types.
 */
export function buildPropertyValue(
  type: string,
  value: string,
): NotionPropertyValue | undefined {
  if (value === '') {
    return undefined;
  }

  switch (type) {
    case 'title':
      return {
        title: [{ text: { content: value } }],
      };
    case 'rich_text':
      return {
        rich_text: [{ text: { content: value } }],
      };
    case 'number': {
      const num = Number(value);
      return Number.isNaN(num) ? undefined : { number: num };
    }
    case 'select':
      return { select: { name: value } };
    case 'multi_select':
      return {
        multi_select: value.split(';').map((v) => ({ name: v.trim() })),
      };
    case 'date': {
      const parts = value.split('|');
      const start = parts[0]?.trim();
      const end = parts[1]?.trim();
      if (start === undefined || start === '') return undefined;
      return {
        date: {
          start,
          ...(end !== undefined && end !== '' ? { end } : {}),
        },
      };
    }
    case 'checkbox':
      return { checkbox: value.toLowerCase() === 'true' };
    case 'url':
      return { url: value };
    case 'email':
      return { email: value };
    case 'phone_number':
      return { phone_number: value };
    case 'relation':
      return {
        relation: value.split(',').map((id) => ({ id: id.trim() })),
      };
    case 'status':
      return { status: { name: value } };
    default:
      logger.warn(`Unsupported property type for import: ${type}. Skipping.`);
      return undefined;
  }
}

/**
 * Extract a human-readable string from a Notion property value.
 */
function extractPropertyValue(prop: NotionPropertyValue): string {
  const type = prop['type'] as string | undefined;
  if (type === undefined) return JSON.stringify(prop);

  switch (type) {
    case 'title':
      return extractRichText(prop['title']);
    case 'rich_text':
      return extractRichText(prop['rich_text']);
    case 'number':
      return prop['number'] !== null && prop['number'] !== undefined
        ? String(prop['number'])
        : '';
    case 'select':
      return extractName(prop['select']);
    case 'multi_select':
      return extractMultiSelect(prop['multi_select']);
    case 'date':
      return extractDate(prop['date']);
    case 'checkbox':
      return String(prop['checkbox'] ?? false);
    case 'url':
      return String(prop['url'] ?? '');
    case 'email':
      return String(prop['email'] ?? '');
    case 'phone_number':
      return String(prop['phone_number'] ?? '');
    case 'formula':
      return extractFormula(prop['formula']);
    case 'relation':
      return extractRelation(prop['relation']);
    case 'rollup':
      return extractRollup(prop['rollup']);
    case 'status':
      return extractName(prop['status']);
    case 'people':
      return extractPeople(prop['people']);
    case 'files':
      return extractFiles(prop['files']);
    case 'created_time':
      return String(prop['created_time'] ?? '');
    case 'last_edited_time':
      return String(prop['last_edited_time'] ?? '');
    case 'created_by':
      return extractName(prop['created_by']);
    case 'last_edited_by':
      return extractName(prop['last_edited_by']);
    default:
      return JSON.stringify(prop);
  }
}

function extractRichText(val: unknown): string {
  if (!Array.isArray(val)) return '';
  return (val as Array<Record<string, unknown>>)
    .map((t) => (t['plain_text'] as string | undefined) ?? '')
    .join('');
}

function extractName(val: unknown): string {
  if (val === null || val === undefined) return '';
  return ((val as Record<string, unknown>)['name'] as string | undefined) ?? '';
}

function extractMultiSelect(val: unknown): string {
  if (!Array.isArray(val)) return '';
  return (val as Array<Record<string, unknown>>)
    .map((s) => (s['name'] as string | undefined) ?? '')
    .join(';');
}

function extractDate(val: unknown): string {
  if (val === null || val === undefined) return '';
  const d = val as Record<string, unknown>;
  const start = (d['start'] as string | undefined) ?? '';
  const end = d['end'] as string | undefined;
  return end !== undefined ? `${start}|${end}` : start;
}

function extractFormula(val: unknown): string {
  if (val === null || val === undefined) return '';
  const f = val as Record<string, unknown>;
  const fType = f['type'] as string | undefined;
  if (fType !== undefined && f[fType] !== undefined) {
    return String(f[fType]);
  }
  return '';
}

function extractRelation(val: unknown): string {
  if (!Array.isArray(val)) return '';
  return (val as Array<Record<string, unknown>>)
    .map((r) => (r['id'] as string | undefined) ?? '')
    .join(',');
}

function extractRollup(val: unknown): string {
  if (val === null || val === undefined) return '';
  const r = val as Record<string, unknown>;
  const rType = r['type'] as string | undefined;
  if (rType === 'array' && Array.isArray(r['array'])) {
    return (r['array'] as unknown[]).map((item) => extractPropertyValue(item as NotionPropertyValue)).join(';');
  }
  if (rType !== undefined && r[rType] !== undefined) {
    return String(r[rType]);
  }
  return '';
}

function extractPeople(val: unknown): string {
  if (!Array.isArray(val)) return '';
  return (val as Array<Record<string, unknown>>)
    .map((p) => (p['id'] as string | undefined) ?? '')
    .join(',');
}

function extractFiles(val: unknown): string {
  if (!Array.isArray(val)) return '';
  return (val as Array<Record<string, unknown>>)
    .map((f) => {
      const fType = f['type'] as string | undefined;
      if (fType === 'external') {
        const external = f['external'] as Record<string, unknown> | undefined;
        return (external?.['url'] as string | undefined) ?? '';
      }
      if (fType === 'file') {
        const file = f['file'] as Record<string, unknown> | undefined;
        return (file?.['url'] as string | undefined) ?? '';
      }
      return '';
    })
    .join(',');
}
