# @dazld/cclsp

[![npm version](https://badge.fury.io/js/@dazld/cclsp.svg)](https://www.npmjs.com/package/@dazld/cclsp)
[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](https://opensource.org/licenses/MIT)
[![Node.js Version](https://img.shields.io/node/v/@dazld/cclsp.svg)](https://nodejs.org)

> Fork of [ktnyt/cclsp](https://github.com/ktnyt/cclsp) with added `execute_command` support for custom LSP commands.

**cclsp** is an MCP server that bridges Language Server Protocol (LSP) servers with LLM-based coding agents via the Model Context Protocol. It provides robust symbol resolution that handles the line/column imprecision common with AI assistants.

This fork adds `execute_command` — a generic tool for invoking `workspace/executeCommand`, and `codeActions` unlocking the full power of language-server-specific commands (e.g., clojure-lsp's `clean-ns`, `extract-function`, `thread-first`, etc.).

## Quick Start

```bash
npm install -g @dazld/cclsp
```

### 1. Create `cclsp.json` in your project root

```json
{
  "servers": [
    {
      "extensions": ["clj", "cljs", "cljc", "edn"],
      "command": ["clojure-lsp"],
      "rootDir": "/absolute/path/to/your-project"
    }
  ]
}
```

### 2. Create `.mcp.json` in your project root

```json
{
  "mcpServers": {
    "cclsp": {
      "command": "cclsp",
      "env": {
        "CCLSP_CONFIG_PATH": "/absolute/path/to/your-project/cclsp.json"
      }
    }
  }
}
```

### 3. Add to `.gitignore`

Both config files contain absolute paths, so they're machine-specific:

```
.mcp.json
cclsp.json
.lsp/
```

### 4. Restart Claude Code

First run takes ~10-30s for the LSP server to index (cached after that).

## MCP Tools

### Standard LSP Tools

| Tool | What it does |
|---|---|
| `find_definition` | Jump to where a symbol is defined |
| `find_references` | Find all usages across workspace |
| `find_workspace_symbols` | Search symbols by name pattern |
| `get_hover` | Type info + docstrings |
| `get_diagnostics` | Errors/warnings for a file |
| `find_implementation` | Find interface implementations |
| `prepare_call_hierarchy` | Set up call hierarchy queries |
| `get_incoming_calls` | Who calls this function? |
| `get_outgoing_calls` | What does this function call? |
| `rename_symbol` | Rename across entire workspace |
| `rename_symbol_strict` | Rename at exact position |
| `get_code_actions` | List available code actions at a position/range |
| `apply_code_action` | Apply a code action by title |
| `restart_server` | Restart LSP if it gets stuck |

### `execute_command` (new in this fork)

Execute any custom LSP command via `workspace/executeCommand`. This unlocks language-server-specific refactoring and code actions that go beyond standard LSP operations.

**Parameters:**

- `file_path`: Path to a file (used to resolve which LSP server to use)
- `command`: The command name (e.g., `"clean-ns"`, `"extract-function"`)
- `arguments`: Command-specific arguments (optional, typically `[file-uri, line, character]`)

**Example — clojure-lsp `clean-ns`:**

```
> Using cclsp.execute_command
  file_path: "src/my_app/core.clj"
  command: "clean-ns"
  arguments: ["file:///path/to/src/my_app/core.clj", 1, 1]

Result: Successfully executed "clean-ns".
Modified files:
- /path/to/src/my_app/core.clj
```

#### clojure-lsp commands available via `execute_command`

| Command | What it does |
|---|---|
| `clean-ns` | Sort/remove unused requires and imports |
| `add-missing-libspec` | Auto-add require for unresolved symbol |
| `extract-function` | Extract expression into a new function |
| `inline-symbol` | Inline a var at its usage sites |
| `thread-first` / `thread-last` | Convert nested calls to threading macros |
| `thread-first-all` / `thread-last-all` | Thread all applicable forms |
| `unwind-thread` / `unwind-all` | Reverse threading |
| `move-to-let` / `expand-let` / `introduce-let` | Let binding refactorings |
| `cycle-coll` | Toggle between `{}` `[]` `()` `#{}` |
| `cycle-privacy` | Toggle public/private |
| `create-test` | Generate test stub for current fn |

This works with any LSP server that supports custom commands — not just clojure-lsp.

### Code Actions

Code actions provide LSP-powered refactorings and quick fixes. Use the two-step workflow:

1. **`get_code_actions`** — discover what's available at a position or range
2. **`apply_code_action`** — apply one by its title

**Example — extract function:**

```
> Using cclsp.get_code_actions
  file_path: "src/core.ts"
  line: 10
  character: 1
  end_line: 25
  end_character: 1

Result: 3 code action(s) available:
  1. Extract function
  2. Extract constant
  3. Move to a new file

> Using cclsp.apply_code_action
  file_path: "src/core.ts"
  line: 10
  character: 1
  end_line: 25
  end_character: 1
  title: "Extract function"

Result: Applying code action: "Extract function"
Modified files:
- /path/to/src/core.ts
```

Code actions work with any LSP server — the available actions depend on what the server supports (e.g., clojure-lsp offers `clean-ns`, `thread-first`, etc. as code actions too).

## Configuration

### Multi-project setup

```json
{
  "servers": [
    {
      "extensions": ["clj", "cljs", "cljc", "edn"],
      "command": ["clojure-lsp"],
      "rootDir": "/path/to/project-a"
    },
    {
      "extensions": ["clj", "cljs", "cljc", "edn"],
      "command": ["clojure-lsp"],
      "rootDir": "/path/to/project-b"
    },
    {
      "extensions": ["ts", "tsx", "js", "jsx"],
      "command": ["typescript-language-server", "--stdio"],
      "rootDir": "/path/to/project-c"
    }
  ]
}
```

### Configuration options

- `extensions`: Array of file extensions this server handles
- `command`: Command array to spawn the LSP server
- `rootDir`: Working directory for the LSP server (optional, defaults to `.`)
- `restartInterval`: Auto-restart interval in minutes (optional)
- `requestTimeout`: Default timeout for LSP requests in milliseconds (optional, default: 30000)
- `initializationOptions`: LSP server initialization options (optional)

### Alternative: setup wizard

```bash
npx @dazld/cclsp setup        # project-level config
npx @dazld/cclsp setup --user # user-level config
```

## When to use `restart_server`

| Change type | LSP auto-detects? | Need restart? |
|---|---|---|
| Edit file contents (save) | Yes | No |
| Add new file | Yes | No |
| `git mv` / rename files | No | Yes |
| Delete files | Partial | Yes to be safe |
| Change `deps.edn` (new deps) | No | Yes |

## Development

```bash
bun install
bun run dev          # dev with hot reload
bun run test         # run tests
bun run lint         # check code style
bun run typecheck    # TypeScript check
bun run build        # build for production
```

## Credits

Original project by [ktnyt](https://github.com/ktnyt/cclsp). This fork is maintained by [dazld](https://github.com/dazld).

## License

MIT
