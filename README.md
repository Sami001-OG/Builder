# Builder — Local-First AI Web-App Builder

A production-grade, local-first AI-powered web application builder that runs entirely on your machine.

## Features

- **Browser-based IDE** at localhost with Monaco editor, terminal, preview, file explorer, AI chat, Git UI
- **AI agent** that inspects, plans, builds, repairs, and verifies your web app
- **Local-first** — no cloud backend, no database, no Redis. Your filesystem + Git is the source of truth
- **Multi-provider** — supports OpenAI, Anthropic, Gemini, OpenRouter, Ollama, llama.cpp, LM Studio
- **Secure** — strict localhost binding, path sandboxing, secret protection, permission-based tool model
- **Cross-platform** — Windows, macOS, Linux

## Requirements

- Node.js ≥ 20
- Git
- npm / pnpm (pnpm recommended)

## Quick Start

```bash
# Clone and install
cd builder
npm install

# Build all packages
npm run build:packages

# Build the web IDE
cd apps/web && npm install && npx vite build && cd ../..

# Start the builder
node apps/cli/dist/index.js start --no-open
```

Then open http://127.0.0.1:4173 in your browser.

## CLI Commands

| Command | Description |
|---------|-------------|
| `builder` / `builder start` | Start the local IDE + runtime |
| `builder doctor` | Check environment and configuration |
| `builder config` | Show configuration |
| `builder config --set key=value` | Update configuration |
| `builder auth --provider <name> --key <key>` | Store API credentials securely |
| `builder version` | Print version |
| `builder update` | Check for updates |

## Configuration

Config file: `~/.builder/config.json`

| Key | Default | Description |
|-----|---------|-------------|
| `provider` | `ollama` | AI provider |
| `model` | `llama3.1` | Model name |
| `baseUrl` | `http://127.0.0.1:11434` | Provider API base URL |
| `serverPort` | `4173` | Local server port |
| `host` | `127.0.0.1` | Bind address |
| `openBrowser` | `true` | Auto-open browser |
| `approvals` | `moderate` | Permission policy: strict / moderate / permissive |
| `theme` | `system` | UI theme |

## Supported Providers

| Provider | Type | Config |
|----------|------|--------|
| OpenAI | Cloud | `--provider openai --key sk-...` |
| Anthropic | Cloud | `--provider anthropic --key sk-ant-...` |
| Gemini | Cloud | `--provider gemini --key AIza...` |
| OpenRouter | Cloud | `--provider openrouter --key sk-or-...` |
| Ollama | Local | `--provider ollama` (default, no key needed) |
| llama.cpp | Local | `--provider llamacpp --baseUrl http://127.0.0.1:8080` |
| LM Studio | Local | `--provider lmstudio --baseUrl http://127.0.0.1:1234/v1` |

## Creating Projects

From the web IDE, use the AI chat to create apps or use the REST API:

```bash
curl -X POST http://127.0.0.1:4173/api/project/create \
  -H 'Content-Type: application/json' \
  -d '{"name": "my-app", "directory": "/tmp", "template": "react-vite-ts"}'
```

Templates: `react-vite-ts`, `react-vite-tailwind`

## GitHub Integration

```bash
builder auth --provider github --key ghp_...
```

Push, pull, commit, diff, and export all from the IDE's Git panel.

## Architecture

```
USER COMPUTER → CLI → LOCAL RUNTIME → LOCALHOST WEB SERVER → BROWSER IDE
                                     → LOCAL PROJECT FILESYSTEM
                                     → LOCAL DEV SERVER → PREVIEW

AI MODEL → LOCAL AGENT RUNTIME → CONTROLLED TOOLS → USER PROJECT
```

## Security

- Strict localhost binding (127.0.0.1, no 0.0.0.0)
- Path traversal protection + project-root sandboxing
- Dangerous command blocking with structured tool validation
- 4-tier permission model (SAFE / MODERATE / HIGH / CRITICAL)
- Secrets never in logs, prompts, or generated project files
- Encrypted credential storage (AES-256-GCM, machine-bound)
- CSRF / origin validation on all API routes
- CSP headers

## Development

```bash
cd builder && npm install && npm run build:packages
cd apps/web && npm install && npx vite  # dev web server at :5173
node apps/cli/dist/index.js start --no-open  # runtime at :4173
```

## Testing

```bash
# Unit tests
node --test tests/unit/run.mjs

# Integration tests
node --test tests/integration/run.mjs
```

## Monorepo Layout

```
builder/
  apps/web/          — React Vite IDE
  apps/cli/          — CLI entrypoint
  packages/
    shared/          — errors, logging, redaction, utilities
    config/          — typed configuration system
    filesystem/      — safe read/write, tree, search, watcher
    project-engine/  — open/create/inspect projects, framework detection
    process-manager/ — start/stop/restart managed processes, port manager
    permissions/     — 4-tier permission model, command validation
    protocol/        — typed agent event protocol (SSE wire format)
    credentials/     — encrypted credential store
    git/             — Git CLI wrapper
    github/          — GitHub API + gh CLI wrapper
    model-gateway/   — multi-provider model abstraction
    agent-tools/     — 28 typed, validated, sandboxed agent tools
    agent/           — AgentController state machine
    runtime/         — HTTP server, SSE, API routes, static file serving
    ui/              — shared UI types
  templates/
    react-vite-ts/
    react-vite-tailwind/
  tests/
    unit/
    integration/
  docs/
```

## License

MIT
