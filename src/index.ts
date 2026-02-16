#!/usr/bin/env node

/**
 * notion-cli — Read and edit Notion pages, databases, and blocks
 * through Markdown and CSV. Designed for AI agent workflows.
 *
 * Usage:
 *   notion-cli search <query>                          Search pages & databases
 *   notion-cli page read <id> [--numbered-lines]       Read page as Markdown
 *   notion-cli page create --parent <id> --file <path> Create page from Markdown
 *   notion-cli page write <id> [--file <path>]        Replace page content
 *   notion-cli page list [--query <text>]              List pages
 *   notion-cli db query <id> [--filter <json>]         Query database → CSV
 *   notion-cli db export <id> --out <file.csv>         Export database → CSV
 *   notion-cli db import <id> --file <file.csv>        Import CSV → database
 *   notion-cli db list                                 List databases
 *   notion-cli db schema <id>                          Show DB schema
 *
 * Global flags:
 *   --json        Structured JSON output (for AI agents)
 *   --token       Override Notion API token
 *   --dry-run     Preview changes without executing
 *   --verbose     Debug output to stderr
 *   --no-color    Disable colored output
 *
 * Authentication:
 *   Set NOTION_TOKEN env var, or use --token, or create ~/.notion-cli.json
 *
 * AI Agent Usage:
 *   All commands support --json for parseable output.
 *   Data goes to stdout; status/progress goes to stderr.
 *   Exit codes: 0=success, 1=error, 2=validation, 3=auth, 4=not_found, 5=rate_limited
 */

import { Command } from 'commander';
import { setJsonMode } from './lib/output.js';
import { setVerbose } from './utils/logger.js';
import { printError } from './lib/output.js';
import { toCliError } from './lib/errors.js';

// Page commands
import { registerPageReadCommand } from './commands/page/read.js';
import { registerPageCreateCommand } from './commands/page/create.js';
import { registerPageWriteCommand } from './commands/page/write.js';
import { registerPagePatchCommand } from './commands/page/patch.js';
import { registerPageListCommand } from './commands/page/list.js';

// Database commands
import { registerDbQueryCommand } from './commands/database/query.js';
import { registerDbExportCommand } from './commands/database/export.js';
import { registerDbImportCommand } from './commands/database/import.js';
import { registerDbListCommand } from './commands/database/list.js';
import { registerDbCreateCommand } from './commands/database/create.js';
import { registerDbSchemaCommand } from './commands/database/schema.js';

// Search command
import { registerSearchCommand } from './commands/search.js';

const program = new Command();

program
  .name('notion-cli')
  .version('1.0.0')
  .description(
    'CLI for reading and editing Notion entries through Markdown and CSV. AI agent friendly.',
  )
  .option('--json', 'Output as structured JSON (for AI agents)')
  .option('--token <token>', 'Notion API integration token')
  .option('--dry-run', 'Preview changes without executing writes')
  .option('-v, --verbose', 'Enable verbose/debug output')
  .option('--no-color', 'Disable colored output')
  .hook('preAction', (_thisCommand, actionCommand) => {
    const opts = actionCommand.optsWithGlobals<{
      json?: boolean;
      verbose?: boolean;
    }>();

    if (opts.json === true) {
      setJsonMode(true);
    }
    if (opts.verbose === true) {
      setVerbose(true);
    }
  });

// ── Page subcommand group ──────────────────────────────────────────
const page = program
  .command('page')
  .description('Read, write, and create Notion pages.');

registerPageReadCommand(page);
registerPageCreateCommand(page);
registerPageWriteCommand(page);
registerPagePatchCommand(page);
registerPageListCommand(page);

// ── Database subcommand group ──────────────────────────────────────
const db = program
  .command('db')
  .description('Query, export, import, and inspect Notion databases.');

registerDbQueryCommand(db);
registerDbExportCommand(db);
registerDbImportCommand(db);
registerDbListCommand(db);
registerDbCreateCommand(db);
registerDbSchemaCommand(db);

// ── Search command (top-level) ─────────────────────────────────────
registerSearchCommand(program);

// ── Global error handler ───────────────────────────────────────────
program.exitOverride();

async function main(): Promise<void> {
  try {
    await program.parseAsync(process.argv);
  } catch (err: unknown) {
    // Commander throws for --help and --version, don't treat as errors
    const commanderErr = err as { code?: string };
    if (
      commanderErr.code === 'commander.helpDisplayed' ||
      commanderErr.code === 'commander.version'
    ) {
      return;
    }

    const cliErr = toCliError(err);
    printError(cliErr.code, cliErr.message);
    process.exitCode = cliErr.exitCode;
  }
}

void main();
