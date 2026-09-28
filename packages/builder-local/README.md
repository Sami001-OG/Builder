# builder-local

Local-first AI-powered web application builder.

```sh
npm install -g builder-local
builder doctor
builder start
```

Opens a local IDE at `http://127.0.0.1:4173` — your filesystem is the source of truth, no cloud required.

Configure a model provider:

```sh
builder auth --provider openai --key <api-key>
```

Supported providers: `openai`, `anthropic`, `gemini`, `openrouter`, `ollama` (no key), `llamacpp`, `lmstudio`.
