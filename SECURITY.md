# Security model

## Credential handling

The router handles three different credential classes and keeps them separate:

- Codex/ChatGPT authorization is accepted only on the dispatcher and forwarded
  only for native GPT model IDs.
- Kimi Code OAuth is read from the Kimi CLI data directory and sent only to the
  configured Kimi Code managed endpoint.
- Kimi Platform API keys are read from a protected file, process environment,
  or macOS Keychain and sent only to the configured Kimi Platform endpoint.

No credential value is written to the model catalog, Codex configuration,
health responses, or normal logs.

## Local files

Sensitive state lives under `$CODEX_HOME/kimi-router`:

| File | Purpose | Mode |
|---|---|---|
| `internal-secret` | Authenticates internal loopback hops | `600` |
| `api-key.secret` | Optional Kimi Platform API key | `600` |
| `native-models.json` | Cached native Codex catalog | `600` |
| `merged-models.json` | Native plus Kimi catalog | `600` |

Kimi OAuth credentials remain under `$KIMI_CODE_HOME` or `~/.kimi-code`; the
project does not copy them into its own state directory.

Never commit either state directory, an API key, a Kimi credential file, or a
Codex authentication file to Git.

## Network exposure

All listeners bind to `127.0.0.1`. Do not change them to `0.0.0.0`, expose them
through a tunnel, or place them on a shared network. The router is intended for
one user's local workstation.

The generated internal key protects component ports from accidental direct
use. It is not a strong boundary against malicious software already running as
the same operating-system user, because same-user processes may be able to read
the service environment or protected files.

## Config safety

The config manager:

- Creates a one-time backup before its first edit.
- Owns a clearly marked block.
- Refuses to overwrite a different user-owned `openai_base_url` or
  `model_catalog_json` value.
- Preserves `model`, `model_provider`, reasoning settings, and profiles.
- Removes only its own block during disable or uninstall.

Review the exact change at any time:

```sh
diff -u ~/.codex/config.toml.pre-kimi-router ~/.codex/config.toml
```

## Dependency and endpoint trust

The runtime depends on LiteLLM and `proper-lockfile`. Review
`package-lock.json`, the Python environment, and release changes before using
this project in a high-trust environment.

Endpoint overrides such as `KIMI_CODE_BASE_URL`, `KIMI_API_BASE_URL`, and
`CODEX_NATIVE_BASE_URL` receive the corresponding credentials. Set them only to
hosts you control and trust.

## Reporting a vulnerability

Do not include access tokens, API keys, credential files, or full request logs
in a public issue. After this repository is published, use a private security
advisory when available; otherwise report the smallest credential-free
reproduction possible.
