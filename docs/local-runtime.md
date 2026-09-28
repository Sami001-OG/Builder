# Local Runtime

Binds `127.0.0.1` (default port 4173, auto-increments if busy).

## Endpoints

| Method | Path | Description |
|--------|------|-------------|
| GET | /api/health | Runtime health |
| GET | /api/models | Provider info |
| GET | /api/events | SSE agent event stream |
| POST | /api/agent/run | Start agent run `{goal, mode?, acceptanceCriteria?}` |
| POST | /api/agent/interrupt | Stop run `{runId}` |
| GET | /api/project | Current project + inspection |
| POST | /api/project/open | Open directory `{path}` |
| POST | /api/project/create | Create from template |
| GET | /api/files | File tree |
| GET/PUT/DELETE | /api/file | Read/write/delete (PUT body `{path, content}`) |
| POST | /api/file/patch | Patch `{path, search, replace}` |
| GET | /api/processes | List managed processes |
| POST | /api/process/start | Start `{command, args}` |
| POST | /api/process/stop, /restart | Manage `{id}` |
| GET | /api/process/output?id= | Tail output |
| POST | /api/dev/start | Start project dev server |
| GET | /api/preview | Preview URL |
| GET | /api/git/status, /diff, /branch | Git reads |
| POST | /api/git/commit, /push, /pull | Git writes |
| GET | /api/github/repositories | List repos |
| POST | /api/github/repository/create, /export | Create/push |
| GET | /api/config | Redacted config |

All other GET paths serve the built web IDE (SPA fallback to index.html).
