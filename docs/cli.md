# CLI Reference

```
builder [start] [--no-open]   Start IDE + runtime (default command)
builder doctor                Environment diagnostics
builder config                Show config (secrets redacted)
builder config --set k=v      Update config (e.g. --set serverPort=4200)
builder auth --provider P --key K   Store provider credential
builder version               Version
builder update                Update info
builder help                  Help
```

Exit codes: 0 success, 1 failure. Ctrl+C triggers clean shutdown (stops managed processes, closes server, releases port).
