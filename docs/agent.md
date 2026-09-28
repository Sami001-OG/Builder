# Agent Guide

## Modes

- `builder` (default) — implement features end-to-end
- `architect` — plan and inspect, minimal writes
- `debugger` — focus on failing builds/tests, repair loop
- `reviewer` — inspect and summarize, no writes
- `exporter` — prepare commits and GitHub export

## State Machine

IDLE → ANALYZE → PLAN → INSPECT → BUILD → RUN → TEST → REVIEW → DONE

Failure branches: BUILD/RUN/TEST → DEBUG → back to that phase (bounded by `retryLimit`).

Terminal: DONE, USER_ABORTED, TIMEOUT, BUDGET_EXCEEDED, UNRECOVERABLE_ERROR.

## Completion Contract

The agent may call `finish_task` only when:

- requested work is implemented
- relevant files were inspected first
- build/test verification passed where applicable
- no unexplained runtime errors
- preview works when relevant
- acceptance criteria are satisfied

## Interrupting

`POST /api/agent/interrupt {runId}` aborts the model stream, stops child commands, preserves filesystem state.

## Tool Reference

28 tools across files, project, commands, dev server, processes, git, github, preview. See `GET /api/tools`.
