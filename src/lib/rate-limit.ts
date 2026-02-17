/**
 * Rate-limit handling with exponential backoff.
 * Notion API has a 3 requests/second rate limit.
 */

import * as logger from '../utils/logger.js';
import { RateLimitError } from './errors.js';
import PQueue from 'p-queue';

const MAX_RETRIES = 5;
const BASE_DELAY_MS = 1000;
const MAX_DELAY_MS = 30_000;

/**
 * Global queue for Notion API requests.
 * Concurrency is set to 3 to stay within Notion's recommended rate limits.
 */
const notionQueue: PQueue = new PQueue({ concurrency: 3 });

/**
 * Execute an async function with both concurrency control and automatic retry on rate-limits.
 */
export async function withRateLimit<T>(
  fn: () => Promise<T>,
  label = 'API call',
): Promise<T> {
  return notionQueue.add(() => withRetry(fn, label));
}

/**
 * Execute an async function with automatic retry on rate-limit (429) errors.
 * Uses exponential backoff with jitter.
 */
async function withRetry<T>(
  fn: () => Promise<T>,
  label = 'API call',
): Promise<T> {
  let lastError: unknown;

  for (let attempt = 0; attempt <= MAX_RETRIES; attempt++) {
    try {
      return await fn();
    } catch (err: unknown) {
      lastError = err;

      if (!isRateLimitError(err)) {
        throw err;
      }

      if (attempt === MAX_RETRIES) {
        throw new RateLimitError(MAX_DELAY_MS);
      }

      const delay = calculateDelay(attempt);
      logger.warn(
        `${label}: Rate limited (attempt ${String(attempt + 1)}/${String(MAX_RETRIES)}). Retrying in ${String(Math.ceil(delay / 1000))}s...`,
      );
      await sleep(delay);
    }
  }

  // This should be unreachable, but satisfies noImplicitReturns
  throw lastError;
}

function isRateLimitError(err: unknown): boolean {
  if (typeof err !== 'object' || err === null) {
    return false;
  }
  const status = (err as Record<string, unknown>)['status'];
  return status === 429;
}

function calculateDelay(attempt: number): number {
  const exponential = BASE_DELAY_MS * Math.pow(2, attempt);
  const capped = Math.min(exponential, MAX_DELAY_MS);
  // Add jitter: 50-100% of the delay
  const jitter = capped * (0.5 + Math.random() * 0.5);
  return Math.round(jitter);
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => {
    setTimeout(resolve, ms);
  });
}
