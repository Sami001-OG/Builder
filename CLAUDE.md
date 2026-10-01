# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## What This Is

Builder is a local-first AI web-app builder: a Node CLI (`apps/cli`) starts a
zero-dependency `node:http` runtime (`packages/runtime`) on 127.0.0.1:4173 that
serves a prebuilt React/Vite IDE (`apps/web`) and exposes project/file/process/
git/agent operations over REST + SSE. An `AgentController` state machine
(`packages/agent`) drives any LLM provider (`packages/model-gateway`) through
30 validated, sandboxed tools (`packages/agent-tools`) that mutate a real
project on disk. No database — filesystem + Git is the source of truth.
See `ARCHITECTURE.md`, `SECURITY.md`, `CONTRIBUTING.md`, `docs/`.

## Commands

```bash
npm install                              # workspace deps (npm workspaces: apps/*, packages/*)
npm run build:packages                   # compile all TS packages in dependency order (REQUIRED before tests/runtime)
node apps/cli/dist/index.js start --no-open   # start runtime on :4173
node apps/cli/dist/index.js doctor       # environment check
cd apps/web && npm install && npx vite   # web IDE dev server with HMR on :5173 (proxies /api → :4173)
cd apps/web && npm run build             # production web build (tsc + vite build); required before bundling
npm run build:builder-local              # esbuild single-file bundle → packages/builder-local (publishable npm package)
node --test tests/unit/run.mjs          # unit tests (rebuilds all packages via tsc first, then node:test)
node --test tests/integration/run.mjs   # integration tests (real server, temp dirs, mocked model fetch)
node scripts/e2e-mock-agent.mjs          # scripted E2E with MockProvider (no network/key); full agent build→repair loop
cd apps/web && npx playwright test       # UI tests (tests/ui/); boots its own runtime, baseURL :4173
```

Single test: `node --test --test-name-pattern="<name>" tests/unit/run.mjs`
(note: the runner still recompiles every package first — see `tests/unit/run.mjs:buildAll`).

⚠️ `npm run lint|format|verify|dev|test:unit` reference `scripts/*.mjs` files that
**do not exist** (only `build-packages.mjs`, `bundle-builder-local.mjs`,
`e2e-mock-agent.mjs` exist). Use the direct commands above instead.

## Architecture

Dependency order for builds (from `scripts/build-packages.mjs` — each package
compiles with `tsc -p tsconfig.json`, extending `tsconfig.base.json` with
`strict`, `NodeNext`, `noUnusedLocals/Parameters`, `noFallthroughCasesInSwitch`):

```
shared → config, filesystem, permissions, protocol, credentials, ui
  → git, github, project-engine, process-manager, model-gateway
  → agent-tools → agent → runtime → apps/cli
```

Key packages (each `@builder/*`, `main: ./dist/index.js` — must be built before use):

- `packages/shared` — `BuilderError` (coded errors, use instead of raw `Error`),
  `redact()` (secret scrubbing for all logs), `createLogger` (JSON-line logger).
- `packages/config` — `loadConfig`/`validateConfig`/`saveConfig`; config file
  `~/.builder/config.json` (provider, model, baseUrl, serverPort, host, approvals).
- `packages/filesystem` — `resolveInRoot` (canonical-path sandbox; all file ops
  must go through it), `safeRead`, `getTree`, `searchFiles`.
- `packages/permissions` — 4-tier model (`decide`, `toolLevel`, `validateCommand`,
  `isDangerousCommand`): SAFE auto-allow, MODERATE approval-gated in strict mode,
  HIGH approval required, CRITICAL explicit approval. Dangerous patterns
  (`rm -rf`, fork bombs…) blocked at validation.
- `packages/protocol` — `makeEvent`/`serializeEvent`/`parseWire`; SSE wire format
  for agent events on `GET /api/events`.
- `packages/model-gateway` — `ModelProvider` interface (`generate()` yields
  `text | tool | done` events); `OpenAICompatibleProvider` covers OpenAI/
  OpenRouter/Ollama/llama.cpp/LM Studio; dedicated Anthropic + Gemini adapters;
  `createProvider()` factory; `AGENT_SYSTEM_PROMPT` (treats repo as untrusted data);
  `MockProvider` for keyless E2E.
- `packages/agent-tools` — `TOOL_DEFS` (30 tools: read/write/patch/delete files,
  dev-server/process mgmt, build/test/lint, git×8, github×3, `finish_task`) each
  with JSON-schema `parameters` + `validate()`; `executeTool(name, input, ctx)`
  enforces permission + sandbox + timeouts. Model never emits raw shell.
- `packages/agent` — `AgentController` state machine (`AgentState` in
  `packages/agent/src/index.ts`): `ANALYZE → PLAN → INSPECT → BUILD → RUN →
  TEST → REVIEW → DONE` (`nextState()`), with `DEBUG → BUILD` auto-repair loop on
  build/test failure and terminal states `USER_ABORTED | TIMEOUT |
  BUDGET_EXCEEDED | UNRECOVERABLE_ERROR`. Emits protocol events per transition.
- `packages/runtime` — plain `node:http` server (no Express), all routes inline
  in `packages/runtime/src/index.ts` (`/api/health|models|events|agent/*|
  project/*|files|file|file/patch|tools|process/*|dev/start|preview|git/*|
  github/*|config`); origin validation, 2MB body limit, CSP headers; binds
  127.0.0.1 only; serves `apps/web/dist` statically.
- `packages/project-engine` — `ProjectEngine` (open/create/inspect),
  `detectFramework`/`detectPackageManager`; project templates in `templates/`
  (`react-vite-ts`, `react-vite-tailwind`).
- `packages/credentials` — AES-256-GCM machine-bound encrypted API-key store
  (mode 0600), never in logs/prompts/project files.
- `apps/cli/src/index.ts` (+ `tui.ts` setup wizard/menu) — `start|doctor|config|
  auth|version|update` commands; version lives here (0.1.2).
- `apps/web/src` — React IDE (Monaco, xterm.js, preview iframe, AI chat, Git panel).
- `packages/builder-local` — publishable bundle output (`dist/bundle.js` +
  `web-dist/` + `templates/`); generated, not source.

## Conventions (from CONTRIBUTING.md + code)

- Structured errors via `BuilderError` with `ErrorCode`; secrets never in logs —
  wrap fields with `redact()` from `@builder/shared`.
- No `any` unless unavoidable (enforced culturally, not by lint — there is no linter).
- Adding a provider: implement `ModelProvider`, add to `createProvider()` switch, document in README.
- Adding a tool: add `ToolDef` to `TOOL_DEFS`, set level in `@builder/permissions`,
  implement handler in `executeTool()` switch, add unit test for schema validation.
- Security invariants: localhost-only bind, cwd confinement, secret-path guard
  (`.env`, `*.pem`, credentials files need privileged workflow), GitHub export
  scans for secrets pre-push.
- Windows: bare exe names need shell resolution — use the `needsShell` execFile
  pattern in `apps/cli/src/index.ts:sh()` / `packages/agent-tools/src/index.ts:runCmd()`;
  never combine `shell: true` with an args array (DEP0190).
- Tests use temp dirs only; never touch real projects or credentials.
