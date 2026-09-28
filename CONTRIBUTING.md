# Contributing to Builder

## Getting Started

1. Clone the repo
2. `cd builder && npm install`
3. `npm run build:packages` — compile all TypeScript packages
4. `cd apps/web && npm install` — install web IDE deps

## Development Workflow

- `node apps/cli/dist/index.js start --no-open` — start the runtime
- `cd apps/web && npx vite` — start the web IDE dev server (HMR)
- The Vite dev server proxies `/api` to the runtime at `:4173`

## Package Dependencies

Packages depend on each other via workspace references. Build order matters:
`shared → config, filesystem, permissions, protocol, credentials, ui → git, github, project-engine, process-manager, model-gateway → agent-tools → agent → runtime → cli`

## Code Quality

- Strict TypeScript (`strict: true` everywhere)
- No `any` unless absolutely unavoidable
- Structured errors via `BuilderError`
- Secrets never in logs — use `redact()` from `@builder/shared`

## Tests

- `node --test tests/unit/run.mjs` — unit tests (path safety, detection, permissions, schemas, config)
- `node --test tests/integration/run.mjs` — integration tests (server, filesystem, processes, git, model mocks)

## Adding a Model Provider

1. Implement `ModelProvider` interface from `@builder/model-gateway`
2. Add to `createProvider()` factory switch
3. Document in README

## Adding an Agent Tool

1. Add `ToolDef` entry to `TOOL_DEFS` in `@builder/agent-tools`
2. Set permission level in `@builder/permissions`
3. Implement handler in `executeTool()` switch
4. Add unit test for schema validation

## Pull Requests

- One logical change per PR
- All tests must pass
- No secrets or credentials in commits
