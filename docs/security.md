# Security (developer notes)

See `SECURITY.md` for the full policy. Implementation pointers:

- Origin check: `checkOrigin()` in `packages/runtime/src/index.ts`
- Path sandbox: `resolveInRoot()` in `packages/filesystem/src/index.ts`
- Command validation: `validateCommand()` + `isDangerousCommand()` in `packages/permissions/src/index.ts`
- Tool approvals: `decide()` + per-run `approvals` map in `packages/agent-tools/src/index.ts`
- Credential encryption: AES-256-GCM in `packages/credentials/src/index.ts`
- Prompt-injection defense: system prompt treats repo content as untrusted data; `finish_task` requires verification
- Error taxonomy: MODEL/AUTH/TOOL/FILESYSTEM/BUILD/RUNTIME/DEPENDENCY/PREVIEW/GIT/GITHUB/TIMEOUT/USER_ABORTED
