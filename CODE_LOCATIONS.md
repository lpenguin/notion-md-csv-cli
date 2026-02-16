# Code Locations of Performance Bottlenecks

This document maps the performance bottlenecks identified in the analysis to specific lines of code.

## 1. Sequential Block Pagination (Minor Bottleneck)

**Location:** `node_modules/notion-to-md/build/utils/notion.js:8-17`

```javascript
const getBlockChildren = async (notionClient, block_id, totalPage) => {
    let result = [];
    let pageCount = 0;
    let start_cursor = undefined;
    
    // BOTTLENECK: Sequential pagination loop
    do {
        const response = await notionClient.blocks.children.list({
            start_cursor: start_cursor,
            block_id: block_id,
        });
        result.push(...response.results);
        start_cursor = response?.next_cursor;
        pageCount += 1;
    } while (start_cursor != null && (totalPage == null || pageCount < totalPage));
    
    return result;
};
```

**Impact:** 
- Default: 100 blocks per request
- 500 blocks = 5 sequential requests
- Time: ~1.5 seconds for 500 blocks
- **Severity: Low** (only top-level blocks affected)

---

## 2. Sequential Recursive Block Fetching (MAJOR BOTTLENECK)

**Location:** `node_modules/notion-to-md/build/notion-to-md.js:177-210`

```javascript
async blocksToMarkdown(blocks, totalPage = null, mdBlocks = []) {
    if (!blocks) return mdBlocks;
    
    // BOTTLENECK: Sequential for loop
    for (let i = 0; i < blocks.length; i++) {
        let block = blocks[i];
        
        if (block.type === "unsupported" || 
            (block.type === "child_page" && !this.config.parseChildPages)) {
            continue;
        }
        
        // BOTTLENECK: Synchronously waits for each block with children
        if ("has_children" in block && block.has_children) {
            const block_id = /* determine block_id */;
            
            // CRITICAL: This await blocks iteration
            let child_blocks = await getBlockChildren(this.notionClient, block_id, totalPage);
            
            mdBlocks.push({
                type: block.type,
                blockId: block.id,
                parent: await this.blockToMarkdown(block),
                children: [],
            });
            
            // CRITICAL: Recursive call - amplifies the problem
            await this.blocksToMarkdown(
                child_blocks,
                totalPage,
                mdBlocks[mdBlocks.length - 1].children
            );
        } else {
            // Process blocks without children
            mdBlocks.push({
                type: block.type,
                blockId: block.id,
                parent: await this.blockToMarkdown(block),
                children: [],
            });
        }
    }
    
    return mdBlocks;
}
```

**Impact:**
- Processes one block at a time
- Each block with children = 1+ API calls
- Recursive depth multiplies the effect
- 100 nested blocks = 100 sequential API calls
- Time: ~30 seconds for 100 nested blocks
- **Severity: CRITICAL** (main bottleneck)

---

## 3. Our Code That Calls The Slow Library

**Location:** `src/lib/markdown.ts:144-167`

```javascript
export async function fetchPageMdBlocks(
  client: Client,
  pageId: string,
): Promise<MdBlock[]> {
  logger.debug(`Fetching page ${pageId} as MdBlocks.`);

  // Creates instance of the slow library
  const n2m = new NotionToMarkdown({ notionClient: client });

  // Custom transformer (not a bottleneck)
  n2m.setCustomTransformer('child_page', (block) => {
    const cpBlock = block as unknown as ChildPageNotionBlock;
    const title = cpBlock.child_page?.title ?? 'Untitled Page';
    const id = block.id.replace(/-/g, '');
    return `[[${title}]](https://www.notion.so/${id})`;
  });

  // BOTTLENECK: Calls the slow library function
  // This is where all the sequential fetching happens
  const blocks = await n2m.pageToMarkdown(pageId);

  // Fix child_page blocks (not a bottleneck)
  fixChildPageBlocks(blocks);

  logger.debug(`Fetched ${String(blocks.length)} MdBlocks.`);
  return blocks;
}
```

**Our Role:**
- We call `n2m.pageToMarkdown()` which triggers the slow sequential fetching
- We have no control over the internal implementation
- **Opportunity:** This is where we could intercept and optimize

---

## 4. Command Entry Point (No Bottleneck, But Relevant)

**Location:** `src/commands/page/read.ts:35-59`

```javascript
// Fetch page metadata (minor overhead)
const pageObj = await withRetry(
  () => client.pages.retrieve({ page_id: pageId }),
  'pages.retrieve',
);

// Extract title (not a bottleneck)
// ... title extraction code ...

// BOTTLENECK: This call is slow for large pages
// All the sequential fetching happens inside this function
let markdown = await withRetry(
  () => notionPageToMarkdown(client, pageId),
  'pageToMarkdown',
);
```

**Impact:**
- The `notionPageToMarkdown()` call is where users wait
- No progress indication during the wait
- **Opportunity:** Add progress indicator here

---

## 5. Rate Limiting (Good, Not a Bottleneck)

**Location:** `src/lib/rate-limit.ts:17-47`

```javascript
export async function withRetry<T>(
  fn: () => Promise<T>,
  label = 'API call',
): Promise<T> {
  let lastError: unknown;

  // Retry loop with exponential backoff
  for (let attempt = 0; attempt <= MAX_RETRIES; attempt++) {
    try {
      return await fn();
    } catch (err: unknown) {
      lastError = err;

      // Only retry on rate limit errors
      if (!isRateLimitError(err)) {
        throw err;
      }

      if (attempt === MAX_RETRIES) {
        throw new RateLimitError(MAX_DELAY_MS);
      }

      // Calculate delay with exponential backoff
      const delay = calculateDelay(attempt);
      logger.warn(
        `${label}: Rate limited (attempt ${attempt + 1}/${MAX_RETRIES}). Retrying in ${Math.ceil(delay / 1000)}s...`,
      );
      await sleep(delay);
    }
  }

  throw lastError;
}
```

**Impact:**
- This is GOOD code - protects against rate limiting
- Only activates on 429 errors
- With sequential fetching, rarely triggers (stays under 3 req/sec)
- **Not a bottleneck**, but would be important if we parallelize

---

## Optimization Opportunities

### Option A: Add Progress Indication (Easy)

**Location:** `src/commands/page/read.ts:56`

```javascript
// BEFORE:
let markdown = await withRetry(
  () => notionPageToMarkdown(client, pageId),
  'pageToMarkdown',
);

// AFTER (proposed):
import ora from 'ora';
const spinner = ora('Fetching page content...').start();
let markdown = await withRetry(
  () => notionPageToMarkdown(client, pageId),
  'pageToMarkdown',
);
spinner.succeed('Page content fetched');
```

---

### Option B: Parallel Fetching (Medium Difficulty)

**Location:** Would modify `node_modules/notion-to-md/build/notion-to-md.js:177-210`
OR create custom implementation in `src/lib/markdown.ts`

```javascript
// PSEUDO-CODE for parallel approach
async function fetchBlocksInParallel(blocks, client) {
  const CONCURRENCY = 3; // Respect 3 req/sec limit
  
  // Process blocks in chunks of 3
  for (let i = 0; i < blocks.length; i += CONCURRENCY) {
    const chunk = blocks.slice(i, i + CONCURRENCY);
    
    // Fetch all blocks in this chunk in parallel
    await Promise.all(
      chunk.map(block => {
        if (block.has_children) {
          return getBlockChildren(client, block.id);
        }
      })
    );
  }
}
```

**Challenges:**
- Need to modify or replace notion-to-md library
- Must respect rate limits (3 req/sec)
- Must preserve block order
- Must handle recursive nesting correctly

---

### Option C: Caching Layer (Medium Difficulty)

**Location:** New file `src/lib/cache.ts` + modifications to `src/lib/markdown.ts`

```javascript
// In cache.ts
const cache = new Map();
const TTL = 5 * 60 * 1000; // 5 minutes

export function getCachedBlocks(pageId) {
  const cached = cache.get(pageId);
  if (cached && Date.now() - cached.timestamp < TTL) {
    return cached.blocks;
  }
  return null;
}

export function setCachedBlocks(pageId, blocks) {
  cache.set(pageId, { blocks, timestamp: Date.now() });
}

// In markdown.ts
export async function fetchPageMdBlocks(client, pageId) {
  // Check cache first
  const cached = getCachedBlocks(pageId);
  if (cached) return cached;
  
  // Fetch from API
  const n2m = new NotionToMarkdown({ notionClient: client });
  const blocks = await n2m.pageToMarkdown(pageId);
  
  // Store in cache
  setCachedBlocks(pageId, blocks);
  
  return blocks;
}
```

---

## Visual Call Stack

```
User runs: notion-cli page read <page-id>

index.ts
  └─> commands/page/read.ts
      └─> client.pages.retrieve()          [1 API call - fast]
      └─> notionPageToMarkdown()
          └─> fetchPageMdBlocks()
              └─> n2m.pageToMarkdown()
                  └─> getBlockChildren()    [1+ API calls - pagination]
                      └─> n2m.blocksToMarkdown()
                          ├─> block 1: has_children
                          │   └─> getBlockChildren()  [1 API call]
                          │       └─> blocksToMarkdown() [recursive]
                          ├─> block 2: has_children
                          │   └─> getBlockChildren()  [1 API call]
                          │       └─> blocksToMarkdown() [recursive]
                          ├─> block 3: has_children
                          │   └─> getBlockChildren()  [1 API call]
                          │       └─> blocksToMarkdown() [recursive]
                          └─> ... continues sequentially ...
                              
Total API calls: 1 + N + M
  where N = pagination calls for top-level
        M = recursive calls for nested blocks
```

---

## Summary

| Location | Severity | Fix Difficulty | Impact if Fixed |
|----------|----------|----------------|-----------------|
| notion-to-md: Sequential pagination | Low | N/A (library) | 10-20% |
| notion-to-md: Sequential recursion | **CRITICAL** | High (library) | 70-90% |
| Our code: No progress UI | Low | **Easy** | UX only |
| Our code: No caching | Medium | Medium | 100% (repeated reads) |

**Best approach:** Start with progress indicators (easy), then consider parallel fetching or caching for real improvements.
