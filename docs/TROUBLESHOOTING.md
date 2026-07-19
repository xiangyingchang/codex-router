# Troubleshooting

Start with:

```sh
./bin/doctor
./bin/status
```

## Kimi is missing from the picker

The catalog is loaded only when Codex starts.

1. Fully quit Codex with `Command-Q` rather than closing its window.
2. Run `./bin/enable`.
3. Reopen Codex and create a new task.
4. Confirm the entries with `codex debug models`.

After updating Codex, run `./bin/refresh-catalog` and restart the app.

## The picker says only Custom

This project must not set a custom provider as the active provider. Check the
root of `~/.codex/config.toml` for a leftover `model_provider` or an older Kimi
profile that is selected globally.

The expected integration uses the built-in provider with only:

```toml
openai_base_url = "http://127.0.0.1:4102/v1"
model_catalog_json = "/.../kimi-router/merged-models.json"
```

`./bin/disable` removes this project's block without touching unrelated
provider or profile settings.

## OAuth says authentication is missing

Run:

```sh
kimi login
./bin/doctor
```

If you configured a custom `KIMI_CODE_HOME`, use the same value when running
the installer so launchd can find it:

```sh
KIMI_CODE_HOME="/your/path" ./bin/install
```

If refresh was rejected, authenticate again with `kimi login`; do not paste or
manually edit refresh tokens.

## API model says the key is missing

Configure and verify it:

```sh
./bin/api-key set
./bin/api-key status
```

No service restart is necessary. Make sure the key belongs to Kimi Platform,
not the separate Kimi Code managed service.

## Native GPT models stopped working

The dispatcher must be running because native GPT traffic also passes through
it while the integration is enabled.

```sh
./bin/status
./bin/enable
```

If recovery is more important than diagnosis, immediately restore direct Codex
routing:

```sh
./bin/disable
```

Then fully quit and reopen Codex.

## A port is already in use

Find the process:

```sh
lsof -nP -iTCP:4100 -iTCP:4101 -iTCP:4102 -iTCP:4103 -sTCP:LISTEN
```

Stop the older router installation before installing this one. Do not run two
installations on the same ports.

## Background service does not start

Inspect launchd and the router log:

```sh
launchctl print "gui/$(id -u)/io.github.kimi-codex-router"
tail -n 200 "${CODEX_HOME:-$HOME/.codex}/kimi-router/router.log"
```

Common causes are moving the repository after installation, deleting `.venv`,
using an older Node binary, or port conflicts. Re-run `./bin/install` from the
repository's permanent location after fixing the cause.

## WebSocket 426 appears in Codex CLI logs

This is expected. The router declines the optional Responses WebSocket and
Codex immediately falls back to HTTP. A successful task after that warning is
not degraded functionally.

## Installer refuses an existing base URL or catalog

The refusal is intentional: replacing an unrelated proxy or custom catalog
would be destructive. Decide which integration should own those root config
keys, disable it explicitly, and then rerun the installer.

## Reset only this integration

```sh
./bin/uninstall
./bin/install
```

This retains credentials and cached state. If the remaining state itself is
suspect, inspect `$CODEX_HOME/kimi-router` manually before removing anything;
the uninstaller deliberately does not delete secrets.
