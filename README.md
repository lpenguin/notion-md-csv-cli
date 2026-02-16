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
