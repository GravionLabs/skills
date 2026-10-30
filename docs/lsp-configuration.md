# LSP Configuration for GitHub Copilot CLI

This repository is configured with **Language Server Protocol (LSP) servers** for TypeScript, Python, Go, and C#. These servers provide GitHub Copilot CLI with precise code intelligence, enabling accurate code navigation and refactoring across your projects.

---

## What are LSP Servers?

LSP servers provide language-specific features such as:
- **Go to Definition**: Jump to where a symbol is defined
- **Find References**: Locate all uses of a symbol
- **Rename**: Safely rename symbols across your entire project
- **Hover Information**: See type information and documentation
- **Document Symbols**: List all symbols in a file
- **Workspace Search**: Search for symbols by name

These capabilities allow Copilot skills to work with code more accurately and safely.

---

## Configuration

The repository includes a project-level LSP configuration file: **`.github/lsp.json`**

This configuration defines LSP servers for the following languages:

### TypeScript / JavaScript
```json
{
  "name": "typescript",
  "languages": ["typescript", "javascript", "typescriptreact", "javascriptreact"],
  "command": "node",
  "args": ["--require", "typescript-language-server/lib/cli", "--stdio"]
}
```

### Python
```json
{
  "name": "python",
  "languages": ["python"],
  "command": "pylsp"
}
```

### Go
```json
{
  "name": "go",
  "languages": ["go"],
  "command": "gopls"
}
```

### C#
```json
{
  "name": "csharp",
  "languages": ["csharp"],
  "command": "omnisharp",
  "args": ["-lsp"]
}
```

---

## How Copilot CLI Loads LSP Servers

When you start a Copilot CLI session, servers are loaded with this priority:

1. **Project Config** (`.github/lsp.json`) — highest priority
2. **Plugin Configs** — from installed Copilot plugins
3. **User Config** (`~/.copilot/lsp-config.json`) — lowest priority

This repository's `.github/lsp.json` takes precedence, ensuring all contributors use the same configuration.

---

## Installation

To enable LSP features, install the language servers for the languages you use:

### TypeScript / JavaScript
```bash
npm install -g typescript-language-server typescript
```

### Python
```bash
pip install python-lsp-server
# or for Pyright:
pip install pyright
```

### Go
```bash
go install github.com/golang/tools/gopls@latest
```

### C#
Download from [OmniSharp releases](https://github.com/OmniSharp/omnisharp-roslyn/releases)

---

## Automatic Startup

Once installed, LSP servers are **automatically started** by Copilot CLI when you:
1. Use a skill in a project with the relevant language
2. Trust the project directory

**No additional configuration or commands are needed.**

---

## Benefits for Skills

LSP servers enhance Copilot skills by:

- **Accuracy**: Operations use the language's compiler/analyzer, not text matching
- **Token Efficiency**: Structured results are compact instead of requiring full file reads
- **Safe Refactoring**: Reliable renaming and code modifications across the entire project
- **Speed**: Background indexing provides near-instant responses

### Example Use Cases

When you run an Angular skill in a TypeScript project:
- Copilot can accurately find component definitions
- Type information helps with precise code generation
- Refactoring suggestions are based on actual type analysis

When you run a Python skill:
- Go-to-definition works accurately even with complex imports
- Copilot understands the actual type information
- Renaming operations update all references reliably

---

## Verification

To verify LSP servers are installed:

```bash
# TypeScript
typescript-language-server --version

# Python
pylsp --version

# Go
gopls version

# C#
omnisharp --help
```

To check if Copilot CLI recognizes them, run inside the repository:

```bash
# List loaded LSP servers
copilot /context
```

---

## Troubleshooting

### LSP Server Not Starting

1. **Verify installation**: Run the verification commands above
2. **Check PATH**: Ensure the server is in your PATH
3. **Check logs**: Look in `~/.copilot/logs/` for error messages
4. **Restart CLI**: Sometimes restarting Copilot CLI helps

### Server Command Not Found

If Copilot CLI says a server command is not found:
1. Install the server (see Installation section above)
2. Restart your terminal
3. Restart Copilot CLI

### Configuration Issues

To reload LSP configuration:

```bash
# Clear LSP cache and reindex
copilot /chronicle reindex
```

---

## See Also

- [Prerequisites](./prerequisites.md) — System requirements and setup
- [GitHub Copilot CLI LSP Documentation](https://docs.github.com/en/copilot/concepts/agents/copilot-cli/lsp-servers)
- [Language Server Protocol](https://microsoft.github.io/language-server-protocol/)
