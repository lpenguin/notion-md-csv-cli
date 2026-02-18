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
| `--numbered-lines` | Prefix every line with its 1-based line number |

**Examples:**

```bash
# Read page content
notion-cli page read abc123def456

# Read with line numbers
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

### `page write` — Replace Page Content

Replace a Notion page's content with new Markdown content. This is a destructive operation that replaces ALL existing content on the page.

```bash
notion-cli page write <page-id> --file content.md
notion-cli page write <page-id> --content "# New Content"
cat content.md | notion-cli page write <page-id>
```

| Option | Description |
|--------|-------------|
| `-f, --file <path>` | Path to Markdown file |
| `--content <markdown>` | Inline Markdown content |

**Image Upload Support:**

When using `page write`, images with `file://` URLs will be automatically uploaded to Notion's file storage:

```markdown
# My Page

![Local Image](file:///path/to/image.png)
![External Image](https://example.com/image.jpg)
```

- Local images with `file://` URLs are uploaded to Notion
- External URLs (http/https) remain as external references
- Supports common formats: PNG, JPG, GIF, WebP, SVG, BMP, TIFF
- Works with both Unix and Windows paths
- Handles URL-encoded paths with special characters

**Examples:**

```bash
# Replace page content from file
notion-cli page write abc123def456 --file mypage.md

# Replace with inline content
notion-cli page write abc123def456 --content "# Hello\n\nNew content"

# Replace from stdin
echo "# Updated\n\nNew content" | notion-cli page write abc123def456

# Dry run to preview changes
notion-cli page write abc123def456 --file mypage.md --dry-run
```

> ⚠️ **Warning:** This command replaces ALL existing content. For partial edits, use `page patch` instead.

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

Query, export, import, and inspect Notion databases.

#### `db list` — List databases

List accessible Notion databases.

```bash
notion-cli db list
notion-cli db list --query "Projects" --limit 10
```

#### `db query` — Query Database

Query a Notion database. Outputs CSV by default, JSON with `--json`.

```bash
notion-cli db query <database-id>
notion-cli db query <database-id> --filter '{"property":"Status","select":{"equals":"Done"}}'
```

#### `db export` — Export to CSV

Export full Notion database to CSV.

```bash
notion-cli db export <database-id> --out data.csv
```

#### `db import` — Import from CSV

Import CSV rows into a Notion database.

```bash
notion-cli db import <database-id> --file data.csv
notion-cli db import <database-id> --file data.csv --sync
```

| Option | Description |
|--------|-------------|
| `-f, --file <path>` | **Required.** Path to CSV file |
| `--sync` | **Synchronize mode.** Pages in Notion that are NOT in the CSV will be **archived** (sent to Trash). |

> ⚠️ **Warning on --sync:** This mode is destructive. It ensures the database in Notion exactly matches your CSV. If a row exists in Notion but its `_notion_id` is missing from your CSV, it will be deleted from the database.

#### `db create` — Create Database

Create a new Notion database in a parent page.

```bash
notion-cli db create --parent <page-id> --title "My Database"
notion-cli db create --parent <page-id> --title "Tasks" --schema '{"Status": {"select": {}}}'
```

| Option | Description |
|--------|-------------|
| `-p, --parent <id>` | **Required.** Parent page ID |
| `-t, --title <text>`| **Required.** Database title |
| `-s, --schema <json>`| Database schema (Notion properties JSON) |

#### `db schema` — Show Schema

Show database property schema.

```bash
notion-cli db schema <database-id>
```

---

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
