# Page Fetch Performance - Quick Summary

## TL;DR

**Why is it slow?** The `notion-to-md` library fetches blocks sequentially and recursively. Each nested block requires a separate API call. For a page with 200 nested blocks, this means 200+ sequential API calls at ~300ms each = 60+ seconds.

## The Problem in One Diagram

```
Current: SEQUENTIAL (SLOW)
━━━━ API 1 ━━━━━━━━ API 2 ━━━━━━━━ API 3 ━━━━ ... ━━━━ API 200 ━━━━
0s              1s              2s              ...            60s

Potential: PARALLEL (FAST)  
━━━━ API 1-3 ━━━━━━━━ API 4-6 ━━━━ ... ━━━━ API 199-200 ━━━━
0s              1s              ...            20s
```

## Root Cause

**File:** `node_modules/notion-to-md/build/notion-to-md.js`

The library processes blocks like this:
```javascript
for (let i = 0; i < blocks.length; i++) {
    if (block.has_children) {
        // WAITS for this to complete before moving to next block
        await getBlockChildren(block.id);  
    }
}
```

This is **sequential by design** because:
1. Simpler code, easier to maintain
2. Never hits Notion's rate limit (3 req/sec)
3. Preserves block order correctly

But it's **slow** because:
- Each API call takes ~300ms
- 100 nested blocks = 100 × 300ms = 30 seconds
- No way to speed it up without modifying the library

## Quick Metrics

| Page Type | Blocks | Nested | Time | Status |
|-----------|--------|--------|------|--------|
| Simple doc | 50 | 0 | 0.5s | ✓ Fast |
| Meeting notes | 100 | 20 | 6s | ⚠ OK |
| Project docs | 200 | 100 | 30s | ✗ Slow |
| Knowledge base | 500 | 300 | 90s | ✗ Very Slow |

## What Can Be Done?

### Quick Wins (No Code Changes)
1. **Add progress indicator** - "Fetching 200 blocks, this may take 30s..."
2. **Document it** - Set user expectations in README

### Real Solutions (Require Code)
3. **Parallel fetching** - Fetch 3 blocks at once (respects rate limit)
   - Expected improvement: 50-70% faster
   - Effort: Medium (need to modify or replace library)
   
4. **Caching** - Remember recently fetched pages
   - Expected improvement: Near-instant for repeated reads
   - Effort: Medium
   
5. **Custom block fetcher** - Replace notion-to-md entirely
   - Expected improvement: 70-90% faster
   - Effort: High (full implementation + maintenance)

## Comparison: Why is Notion's Web UI Faster?

| This Tool (Public API) | Notion Web UI (Internal) |
|------------------------|--------------------------|
| REST API with HTTP overhead | WebSocket (persistent connection) |
| 3 requests/second limit | No public limit |
| Sequential by library design | Optimized parallel fetching |
| No caching | Aggressive caching |
| Refetch entire page | Incremental updates |

## Bottom Line

**The slowness is inherent to:**
1. The public Notion API (no batch endpoints)
2. The notion-to-md library (sequential design)
3. The nature of nested content (recursive fetching required)

**Best pragmatic solution:**
1. Add progress indicators (immediate)
2. Implement parallel fetching with rate-limit awareness (moderate effort, 50-70% improvement)
3. Consider caching for repeated operations (good for workflows)

**Not recommended:**
- Forking/replacing notion-to-md (high maintenance burden)
- Removing retry logic (would hit rate limits)
- Batch API (doesn't exist in Notion's public API)

## For Developers

If you want to improve this, start here:
- **File to modify:** `src/lib/markdown.ts` (specifically `fetchPageMdBlocks`)
- **Approach:** Intercept blocks after `n2m.pageToMarkdown()` and fetch children in parallel
- **Constraint:** Never exceed 3 concurrent requests (Notion rate limit)
- **Test with:** Large nested pages to measure improvement

See `PERFORMANCE_ANALYSIS.md` for detailed technical analysis and `PERFORMANCE_VISUAL.md` for diagrams.
