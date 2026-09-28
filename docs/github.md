# GitHub Integration

Optional. Local projects work fully without GitHub.

1. Authenticate: `gh auth login` (preferred) or `builder auth --provider github --key ghp_...`
2. List: `GET /api/github/repositories`
3. Create: `POST /api/github/repository/create {name}`
4. Export: review branch + diff in the IDE, confirm, then `POST /api/github/export {remoteUrl}`

The export flow never pushes silently — the UI shows branch, changed files, and diff for confirmation first.
Secret-like content blocks the push with a warning.
