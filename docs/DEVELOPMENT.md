# Development guide

## Repository layout

- `src/router.mjs` dispatches native and namespaced Kimi models.
- `src/oauth-forwarder.mjs` owns Kimi CLI OAuth loading and refresh.
- `src/api-forwarder.mjs` owns Kimi Platform API-key injection.
- `src/start.mjs` supervises the four loopback processes.
- `src/catalog.mjs` builds the merged Codex model catalog.
- `src/config-manager.mjs` owns the marked Codex config block.
- `src/service-macos.mjs` owns the launchd integration.
- `litellm.yaml` defines Responses-to-Chat-Completions model adapters.

## Local checks

```sh
npm ci
npm run check
npm test
for file in bin/*; do sh -n "$file"; done
```

The automated tests use local mock servers and synthetic credentials. They
verify Zstandard request decoding, native header forwarding, Kimi credential
isolation, API model/effort rewriting, and both Codex compaction formats.

## Prepare without changing Codex

```sh
./bin/install --prepare-only
```

For an isolated state directory:

```sh
test_home=$(mktemp -d)
CODEX_HOME="$test_home" \
KIMI_CODEX_STATE_DIR="$test_home/kimi-router" \
./bin/install --prepare-only
```

Do not point a test instance at the production ports while the LaunchAgent is
running. Override all four `KIMI_*_PORT` values together.

## Full API-chain mock

`test/mock-kimi-api.mjs` is a strict local Chat Completions endpoint. It rejects
the request unless the API forwarder removed Codex headers, installed the test
API key, selected `kimi-k3`, and forced maximum reasoning.

Never use a real API key in a test fixture, command history, or committed file.
