# Testing

## Unit (`tests/unit/run.mjs`)

Builds all packages with TypeScript, then runs `node:test` suites for:

- path traversal blocking
- package-manager + framework detection
- dangerous-command blocking
- permission levels + approval decisions
- tool schema validation
- config validation
- protocol serialization round-trip
- log redaction
- free-port finder
- provider factory coverage

## Integration (`tests/integration/run.mjs`)

- filesystem + project-engine round-trip (create, read, write, patch, boundary)
- process manager start/output/stop
- local server: health, SSE, project create, file tree
- git ops in a temp repo (init, commit, status, log)
- model adapters with mocked fetch (text, tool_call, 401)

## E2E (manual + scripted)

`scripts/e2e-mock-agent.mjs` exercises the full loop against a temp project:

1. start runtime → 2. create React/Vite/TS project → 3. mock-agent run (inspect, write, patch, build) →
4. verify files + build output → 5. introduce controlled error → 6. mock-agent repair →
7. verify build passes → 8. file watcher detects external edit → 9. git status + commit →
10. confirm child cleanup → 11. restart + reopen from filesystem alone.

All E2E uses temp dirs; never touches the developer's real projects or credentials.
