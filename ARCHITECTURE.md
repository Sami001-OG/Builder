# Architecture

## Overview

```
USER COMPUTER
  └─ CLI (@builder/cli)
       └─ LOCAL RUNTIME (@builder/runtime)
            ├─ HTTP API (health, project, files, processes, git, github, agent, config)
            ├─ SSE event stream (/api/events)
            ├─ Static file server (built web IDE)
            └─ BROWSER IDE (@builder/web)
                 ├─ AI chat → POST /api/agent/run
                 ├─ Explorer/Monaco → /api/files, /api/file*
                 ├─ Terminal (xterm.js) → /api/process/*
                 ├─ Preview iframe → /api/preview, /api/dev/start
                 └─ Git panel → /api/git/*

AI MODEL (any provider via @builder/model-gateway)
  └─ LOCAL AGENT RUNTIME (@builder/agent :: AgentController)
       └─ CONTROLLED TOOLS (@builder/agent-tools, 28 tools)
            └─ USER PROJECT (real files on disk)
```

## Key Decisions

1. **No database.** Project state = filesystem + Git. Session state (conversation, tool results) = in-memory.
2. **Zero runtime dependencies.** The runtime uses only Node stdlib (`node:http`, no Express/Fastify). The web app is prebuilt static files.
3. **Structured tool calls only.** The model never emits raw shell. Every tool has schema + validation + permission level + timeout.
4. **Explicit agent state machine.** IDLE → ANALYZE → PLAN → INSPECT → BUILD → RUN → TEST → REVIEW → DONE, with DEBUG repair loops and terminal states (USER_ABORTED, TIMEOUT, BUDGET_EXCEEDED, UNRECOVERABLE_ERROR).
5. **Pluggable providers.** `ModelProvider` interface; OpenAI-compatible adapter covers OpenAI/OpenRouter/Ollama/llama.cpp/LM Studio; dedicated Anthropic + Gemini adapters.

## Data Flow: Agent Run

1. `POST /api/agent/run {goal}` → AgentController creates runId + transaction ID
2. ANALYZE → PLAN → INSPECT: model reads tree, package.json, relevant files
3. BUILD: model issues write_file/apply_patch calls (validated, sandboxed)
4. RUN: start_dev_server, detect preview URL from process output
5. TEST: run_build/run_tests; on failure → DEBUG → re-patch → rebuild (bounded retries)
6. REVIEW → DONE only after verification; `finish_task` tool marks completion

## Security Boundaries

- HTTP layer: origin validation, 2MB body limit, CSP headers
- Tool layer: permission decisions per policy, dangerous-command blocklist, cwd confinement
- Filesystem layer: canonical-path sandbox, secret-path guard
- Process layer: group kill on Unix, timeout, output caps, no orphan servers
