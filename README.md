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

## Commands

### Pages

```bash
# Read page as Markdown
notion-cli page read <page-id>
notion-cli page read <page-id> --numbered-lines  # With line numbers (for patching)

# Write Markdown to page
notion-cli page write <page-id> --file content.md
notion-cli page write <page-id> --content "# Hello"

# Create new page
notion-cli page create --parent <page-id> --title "My Page" --file content.md

# Patch page content (AI agent friendly)
notion-cli page patch <page-id> --lines 5:10 --content "new content"

# List/search pages
notion-cli page list
notion-cli page list --query "search term" --limit 20
```

### Databases

```bash
# Query database
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
# Search pages
notion-cli search "query" --type page

# Search databases
notion-cli search "query" --type database
```

## Options

| Flag | Description |
|------|-------------|
| `--token` | Notion API token (or use NOTION_TOKEN env) |
| `--json` | Output in JSON format (for scripting) |
| `-y, --yes` | Skip confirmation prompts |
| `--dry-run` | Preview changes without applying |
| `-v, --verbose` | Enable verbose logging |

## AI Agent Usage

The CLI is designed for AI/coding agents:

1. **Line-numbered output**: Use `--numbered-lines` to get line numbers for precise patching
2. **Patch support**: Apply changes via line ranges (e.g., `--lines 192:256`)
3. **JSON output**: Use `--json` for machine-readable output
4. **No prompts**: Use `-y` to skip confirmations

Example agent workflow:

```bash
# 1. Read page with line numbers
notion-cli page read abc123 --numbered-lines

# 2. Patch specific lines
notion-cli page patch abc123 --lines 5:10 --content "replacement text" -y
```

## License

MIT
