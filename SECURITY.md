# Security Policy

## Local Execution Model

Builder runs entirely on your machine. There is no cloud backend. The local HTTP server binds to `127.0.0.1` only — never `0.0.0.0` unless you explicitly set `exposeLan: true`.

## Filesystem Restrictions

- All file operations are scoped to the selected project root
- Canonical-path checks prevent `../` traversal, absolute-path escape, and symlink escape
- Default ignores: `node_modules`, `dist`, `build`, `coverage`, `.cache`, `.git`
- Secret-like paths (`.env`, `*.pem`, `*.key`, `credentials.*`, `secrets.*`) require an explicit privileged workflow

## Command Permissions

| Level | Tools | Approval |
|-------|-------|----------|
| SAFE | read, list, search, inspect, git read-only | Auto-allow |
| MODERATE | write, patch, delete, build, test, dev server | Auto-allow (moderate), approval (strict) |
| HIGH | install, GitHub ops, push/pull | Approval required |
| CRITICAL | force push, repo deletion, outside-root ops | Explicit approval, never auto |

Dangerous patterns (`rm -rf`, `format`, fork bombs, etc.) are blocked at validation time.

## Secret Handling

- Cloud API keys stored in encrypted file (AES-256-GCM, machine-bound key), mode `0600`
- Never in: project files, browser localStorage, logs, prompts, or Git repos
- `redact()` scrubs all structured logs
- GitHub export scans for secret-like content before push

## Model Data Flow

- External providers receive only: user goal, relevant file snippets, tool results
- Entire repo is never sent wholesale — relevance-ranked context selection
- Repository content is treated as **untrusted data** — never overrides system policy

## Known Limitations

- File credential store is machine-bound encryption, not OS keychain. Native keychain integration is a planned improvement.
- WebSocket/SSE uses origin validation, not auth tokens — safe for single-user localhost, not for shared machines with untrusted local users.

## Responsible Disclosure

Report vulnerabilities privately to the maintainers. Do not open public issues for security bugs.
