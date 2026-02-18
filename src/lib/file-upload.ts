/**
 * Utilities for uploading files to Notion.
 * 
 * Handles file:// URLs by uploading them to Notion's file storage
 * and returning the file upload ID for use in blocks.
 */

import { type Client } from '@notionhq/client';
import { readFileSync } from 'node:fs';
import { basename } from 'node:path';
import { type CreateFileUploadResponse } from '@notionhq/client/build/src/api-endpoints.js';
import * as logger from '../utils/logger.js';
import { withRateLimit } from './rate-limit.js';

/**
 * Upload a local file to Notion.
 * 
 * @param client - Notion client
 * @param filePath - Local file path (without file:// prefix)
 * @returns The file upload ID to use in blocks
 */
export async function uploadFileToNotion(
  client: Client,
  filePath: string,
): Promise<string> {
  logger.debug(`Uploading file to Notion: ${filePath}`);

  // Read file content
  const fileContent = readFileSync(filePath);
  const filename = basename(filePath);
  
  // Determine content type based on file extension
  const contentType = getContentType(filename);
  
  // Create file upload
  const uploadResponse = await withRateLimit(
    () =>
      client.fileUploads.create({
        mode: 'single_part',
        filename,
        content_type: contentType,
      }),
    'fileUploads.create',
  ) as CreateFileUploadResponse;
  
  logger.debug(`Created file upload with ID: ${uploadResponse.id}`);
  
  // Send file content
  // Convert Buffer to Blob
  const blob = new Blob([fileContent], { type: contentType });
  
  await withRateLimit(
    () =>
      client.fileUploads.send({
        file_upload_id: uploadResponse.id,
        file: {
          data: blob,
          filename,
        },
      }),
    'fileUploads.send',
  );
  
  logger.debug(`File uploaded successfully: ${uploadResponse.id}`);
  
  return uploadResponse.id;
}

/**
 * Determine MIME type from filename extension.
 */
function getContentType(filename: string): string {
  const ext = filename.toLowerCase().split('.').pop();
  
  const mimeTypes: Record<string, string> = {
    jpg: 'image/jpeg',
    jpeg: 'image/jpeg',
    png: 'image/png',
    gif: 'image/gif',
    webp: 'image/webp',
    svg: 'image/svg+xml',
    bmp: 'image/bmp',
    ico: 'image/x-icon',
    tiff: 'image/tiff',
    tif: 'image/tiff',
  };
  
  return mimeTypes[ext ?? ''] ?? 'application/octet-stream';
}

/**
 * Check if a URL is a file:// URL.
 */
export function isFileUrl(url: string): boolean {
  return url.startsWith('file://');
}

/**
 * Convert file:// URL to local file path.
 * Handles both Unix and Windows paths.
 */
export function fileUrlToPath(url: string): string {
  if (!isFileUrl(url)) {
    return url;
  }
  
  // Remove file:// prefix
  let path = url.slice(7);
  
  // Handle Windows paths (file:///C:/path)
  if (/^\/[A-Za-z]:/.test(path)) {
    path = path.slice(1);
  }
  
  // Decode URL encoding
  path = decodeURIComponent(path);
  
  return path;
}
