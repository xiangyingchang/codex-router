import { spawn } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import path from "node:path";

import {
  INTERNAL_SECRET_PATH,
  MERGED_CATALOG_PATH,
  PORTS,
  SOURCE_ROOT,
  loopback,
} from "./paths.mjs";

const litellm =
  process.env.KIMI_LITELLM_BIN || path.join(SOURCE_ROOT, ".venv", "bin", "litellm");
if (!existsSync(litellm)) {
  throw new Error(`LiteLLM is not installed at ${litellm}; run ./bin/install.`);
}
if (!existsSync(INTERNAL_SECRET_PATH)) {
  throw new Error(`Internal service key is missing; run ./bin/install.`);
}
const internalKey = readFileSync(INTERNAL_SECRET_PATH, "utf8").trim();
if (!internalKey) throw new Error("Internal service key is empty.");

const commonEnv = {
  KIMI_INTERNAL_KEY: internalKey,
  KIMI_OAUTH_FORWARD_BASE_URL: loopback(PORTS.oauth, "/v1"),
  KIMI_API_FORWARD_BASE_URL: loopback(PORTS.api, "/v1"),
  KIMI_GATEWAY_BASE_URL: loopback(PORTS.gateway, "/v1"),
  KIMI_OAUTH_HEALTH_URL: loopback(PORTS.oauth, "/health"),
  KIMI_API_HEALTH_URL: loopback(PORTS.api, "/health"),
  KIMI_GATEWAY_HEALTH_URL: loopback(PORTS.gateway, "/health/liveliness"),
  KIMI_ROUTER_CATALOG: MERGED_CATALOG_PATH,
  KIMI_FORWARD_PORT: String(PORTS.oauth),
  KIMI_API_FORWARD_PORT: String(PORTS.api),
  KIMI_GATEWAY_PORT: String(PORTS.gateway),
  KIMI_ROUTER_PORT: String(PORTS.router),
  LITELLM_MASTER_KEY: internalKey,
  LITELLM_LOG: "ERROR",
  LITELLM_TELEMETRY: "False",
  NO_COLOR: "1",
};

const children = [];
let shuttingDown = false;

function run(command, args, extraEnv = {}) {
  const child = spawn(command, args, {
    cwd: SOURCE_ROOT,
    env: { ...process.env, ...commonEnv, ...extraEnv },
    stdio: "inherit",
  });
  children.push(child);
  return child;
}

function waitForExit(child, label) {
  if (child.exitCode !== null || child.signalCode !== null) {
    return Promise.resolve({ label, code: child.exitCode, signal: child.signalCode });
  }
  return new Promise((resolve) => {
    child.once("exit", (code, signal) => resolve({ label, code, signal }));
  });
}

async function waitForHealth(url, headers = {}, timeoutMs = 30_000, expectedService) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    try {
      const response = await fetch(url, {
        headers,
        signal: AbortSignal.timeout(1_000),
      });
      if (response.ok) {
        if (!expectedService) return;
        const payload = await response.json().catch(() => ({}));
        if (payload.service === expectedService) return;
      }
    } catch {
      // The service is still starting.
    }
    await new Promise((resolve) => setTimeout(resolve, 200));
  }
  throw new Error(`Timed out waiting for ${url}`);
}

function stopChildren() {
  if (shuttingDown) return;
  shuttingDown = true;
  for (const child of children) {
    if (child.exitCode === null && child.signalCode === null) child.kill("SIGTERM");
  }
  setTimeout(() => {
    for (const child of children) {
      if (child.exitCode === null && child.signalCode === null) child.kill("SIGKILL");
    }
  }, 3_000).unref();
}

for (const signal of ["SIGINT", "SIGTERM"]) process.on(signal, stopChildren);

const oauth = run(process.execPath, [path.join(SOURCE_ROOT, "src", "oauth-forwarder.mjs")]);
await waitForHealth(loopback(PORTS.oauth, "/health"));

const api = run(process.execPath, [path.join(SOURCE_ROOT, "src", "api-forwarder.mjs")]);
await waitForHealth(loopback(PORTS.api, "/health"));

const gateway = run(litellm, [
  "--config",
  path.join(SOURCE_ROOT, "litellm.yaml"),
  "--host",
  "127.0.0.1",
  "--port",
  String(PORTS.gateway),
]);
await waitForHealth(
  loopback(PORTS.gateway, "/health/liveliness"),
  { Authorization: `Bearer ${internalKey}` },
);

const router = run(process.execPath, [path.join(SOURCE_ROOT, "src", "router.mjs")]);
await waitForHealth(
  loopback(PORTS.router, "/health"),
  {},
  30_000,
  "kimi-codex-router",
);

console.error(`[kimi-codex-router] ready at ${loopback(PORTS.router, "/v1")}`);

const result = await Promise.race([
  waitForExit(oauth, "OAuth forwarder"),
  waitForExit(api, "API forwarder"),
  waitForExit(gateway, "LiteLLM gateway"),
  waitForExit(router, "Codex router"),
]);
if (!shuttingDown) {
  console.error(
    `[kimi-codex-router] ${result.label} exited (code=${String(result.code)}, signal=${String(result.signal)}).`,
  );
}
stopChildren();
await Promise.all(children.map((child) => waitForExit(child, "child")));
process.exit(result.code || 0);
