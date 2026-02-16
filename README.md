# notion-md-csv-cli

CLI tool for reading and editing Notion entries through Markdown and CSV. AI agent friendly.

## Installation

```bash
# Run directly with npx
npx notion-md-csv-cli page read <page-id>

# Or install globally
npm install -g notion-md-csv-cli
notion-cli page read <page-id>
```

## Configuration

Set your Notion Integration Token:

```bash
export NOTION_TOKEN=ntn_xxx

# Or pass directly
notion-cli --token ntn_xxx page read <page-id>
```

You can also create a `~/.notion-cli.json` config file:

```json
{
  "token": "ntn_xxx"
}
```

## Global Options

| Flag | Description |
|------|-------------|
| `--token <token>` | Notion API integration token (overrides env/config) |
| `--json` | Structured JSON output for machine consumption |
| `--dry-run` | Preview changes without executing writes |
| `-v, --verbose` | Enable debug output to stderr |
| `--no-color` | Disable colored output |

## Commands

### `page read` — Read a Notion Page as Markdown

Fetch a Notion page and output its content as Markdown. This command is idempotent and read-only.

```bash
notion-cli page read <page-id>
notion-cli page read <page-id> --numbered-lines
```

| Option | Description |
|--------|-------------|
| `--numbered-lines` | Prefix every line with its 1-based line number (for use with `page patch --lines`) |

**Examples:**

```bash
# Read page content
notion-cli page read abc123def456

# Read with line numbers for patching
notion-cli page read abc123def456 --numbered-lines
#  1: # My Document
#  2:
#  3: Some content here.
#  4: - Item A
#  5: - Item B

# Read as JSON (for scripting)
notion-cli page read abc123def456 --json
```

When `--json` is enabled, the output includes `pageId`, `title`, and `markdown` fields. Status messages are always written to stderr, and the markdown content goes to stdout, so you can pipe it safely: `notion-cli page read <id> > page.md`.

---

### `page patch` — Surgically Edit Page Content

Partially edit a Notion page using line-range replacement. Designed for AI agents and coding agents that need to make targeted edits without replacing the entire page.

```bash
notion-cli page patch <page-id> --lines <START:END> --content <text>
notion-cli page patch <page-id> --lines <START:END> --file <path>
```

| Option | Description |
|--------|-------------|
| `--lines <START:END>` | **Required.** 1-indexed inclusive line range to replace (e.g. `5:12`) |
| `-f, --file <path>` | Path to a file containing the replacement content |
| `--content <text>` | Inline replacement content (supports `\n` escape sequences) |

One of `--file` or `--content` must be provided.

**How it works:**

1. Fetches the page as Markdown, preserving internal block IDs.
2. Builds a mapping from line numbers to Notion blocks.
3. Identifies which blocks overlap with the edit range.
4. Deletes only the affected blocks and inserts new ones — the rest of the page is untouched.

This is a *surgical* operation: unaffected blocks keep their IDs, comments, and history. Child blocks (nested list items) are handled correctly.

**Examples:**

```bash
# Replace a single line
notion-cli page patch abc123 --lines 5:5 --content "Updated line 5"

# Replace a range of lines from a file
notion-cli page patch abc123 --lines 10:25 --file fix.md

# Delete lines (empty content)
notion-cli page patch abc123 --lines 8:12 --content ""

# Insert new lines (replace a single line with multiple)
notion-cli page patch abc123 --lines 5:5 --content "Line A\nLine B\nLine C"

# Preview changes without applying
notion-cli page patch abc123 --lines 5:10 --content "new text" --dry-run

# Verbose output to see block-level operations
notion-cli page patch abc123 --lines 5:10 --file fix.md --verbose
```

**Typical workflow (AI agent):**

```bash
# Step 1: Read the page with numbered lines
notion-cli page read abc123 --numbered-lines

# Step 2: Identify the lines to change from the numbered output

# Step 3: Apply the patch
notion-cli page patch abc123 --lines 42:45 --content "replacement"

# Step 4: Verify the result
notion-cli page read abc123 --numbered-lines
```

> **Note:** Line numbers change after a patch. Always re-read the page with `--numbered-lines` before making another patch.

---

### `page write` — Replace Entire Page Content

Replace all content on a Notion page with Markdown. **This deletes all existing blocks.**

```bash
notion-cli page write <page-id> --file content.md
notion-cli page write <page-id> --content "# Hello\n\nWorld"
```

Use `page patch` instead if you only need to change part of the page.

---

### `page create` — Create a New Page

Create a new Notion page from Markdown content.

```bash
notion-cli page create --parent <page-id> --file content.md
notion-cli page create --parent <page-id> --title "My Page" --content "# Hello"
notion-cli page create --parent <db-id> --db --file entry.md
```

| Option | Description |
|--------|-------------|
| `--parent <id>` | **Required.** Parent page or database ID |
| `-f, --file <path>` | Path to Markdown file |
| `--content <markdown>` | Inline Markdown content |
| `--title <title>` | Page title (overrides H1 in content) |
| `--db` | Create as a database entry instead of a sub-page |

---

### `page list` — List Pages

List or search Notion pages accessible to the integration.

```bash
notion-cli page list
notion-cli page list --query "search term" --limit 20
notion-cli page list --cursor <cursor>
```

---

### Databases

```bash
# Query database entries
notion-cli db query <database-id>
notion-cli db query <database-id> --filter '{"property":"Status","select":{"equals":"Done"}}'

# Export to CSV
notion-cli db export <database-id> --out data.csv

# Import from CSV
notion-cli db import <database-id> --file data.csv

# List databases
notion-cli db list

# Get database schema
notion-cli db schema <database-id>
```

### Search

```bash
notion-cli search "query"
notion-cli search "query" --type page
notion-cli search "query" --type database
```

## Exit Codes

| Code | Meaning |
|------|---------|
| `0` | Success |
| `1` | General error |
| `2` | Validation error (bad arguments) |
| `3` | Authentication error |
| `4` | Not found |
| `5` | Rate limited |

## License

MIT
