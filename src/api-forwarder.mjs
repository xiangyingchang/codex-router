import { execFileSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import http from "node:http";

import {
  HOP_BY_HOP_HEADERS,
  pipeResponse,
  readRequestBody,
  requireInternalAuth,
  writeJson,
} from "./http-utils.mjs";
import { API_KEY_PATH, PORTS } from "./paths.mjs";

const VERSION = "0.1.0";
const LISTEN_HOST = process.env.KIMI_API_FORWARD_HOST || "127.0.0.1";
const LISTEN_PORT = Number(process.env.KIMI_API_FORWARD_PORT || PORTS.api);
const API_BASE = (
  process.env.KIMI_API_BASE_URL || "https://api.moonshot.cn/v1"
).replace(/\/+$/, "");
const API_KEY_FILE = process.env.KIMI_API_KEY_FILE || API_KEY_PATH;
const INTERNAL_KEY = process.env.KIMI_INTERNAL_KEY;
const QUIET = process.env.KIMI_PROXY_QUIET === "1";

if (!INTERNAL_KEY) throw new Error("KIMI_INTERNAL_KEY is required.");

function keyFromKeychain() {
  if (process.platform !== "darwin") return undefined;
  try {
    const value = execFileSync(
      "/usr/bin/security",
      ["find-generic-password", "-s", "kimi-codex-api", "-a", "default", "-w"],
      { encoding: "utf8", timeout: 2_000, stdio: ["ignore", "pipe", "ignore"] },
    ).trim();
    return value || undefined;
  } catch {
    return undefined;
  }
}

function resolveApiKey() {
  const environment =
    process.env.KIMI_API_KEY?.trim() || process.env.MOONSHOT_API_KEY?.trim();
  if (environment) return { value: environment, source: "environment" };
  if (existsSync(API_KEY_FILE)) {
    const value = readFileSync(API_KEY_FILE, "utf8").trim();
    if (value) return { value, source: "file" };
  }
  const keychain = keyFromKeychain();
  return keychain ? { value: keychain, source: "keychain" } : undefined;
}

function normalizeBody(buffer, contentType) {
  if (!buffer.length || !String(contentType || "").includes("application/json")) {
    return buffer;
  }
  const payload = JSON.parse(buffer.toString("utf8"));
  if (!payload || typeof payload !== "object" || Array.isArray(payload)) return buffer;
  payload.model = "kimi-k3";
  payload.reasoning_effort = "max";
  delete payload.thinking;
  return Buffer.from(JSON.stringify(payload), "utf8");
}

function upstreamHeaders(requestHeaders, body, apiKey) {
  const headers = {};
  for (const [name, value] of Object.entries(requestHeaders)) {
    const lower = name.toLowerCase();
    if (HOP_BY_HOP_HEADERS.has(lower) || lower === "authorization") continue;
    if (lower.startsWith("x-msh-") || lower.startsWith("x-codex-")) continue;
    if (lower.startsWith("x-openai-") || lower === "chatgpt-account-id") continue;
    if (lower === "originator" || lower === "user-agent" || lower === "accept-encoding") continue;
    if (value !== undefined) headers[name] = Array.isArray(value) ? value.join(", ") : value;
  }
  headers.Authorization = `Bearer ${apiKey}`;
  headers["User-Agent"] = `kimi-codex-router/${VERSION}`;
  headers["Accept-Encoding"] = "identity";
  if (body.length) headers["Content-Length"] = String(body.length);
  return headers;
}

function credentialHealth() {
  const credential = resolveApiKey();
  return credential
    ? { credential_present: true, credential_source: credential.source }
    : {
        credential_present: false,
        setup: "Run ./bin/api-key set from the kimi-codex-router repository.",
      };
}

async function handleRequest(request, response) {
  const startedAt = Date.now();
  const requestUrl = new URL(
    request.url || "/",
    `http://${request.headers.host || LISTEN_HOST}`,
  );
  if (request.method === "GET" && requestUrl.pathname === "/health") {
    writeJson(response, 200, { ok: true, ...credentialHealth() });
    return;
  }
  if (!requireInternalAuth(request, response, INTERNAL_KEY)) return;

  const route = requestUrl.pathname.replace(/^\/v1(?=\/|$)/, "");
  if (
    !(
      (request.method === "POST" && route === "/chat/completions") ||
      (request.method === "GET" && route === "/models")
    )
  ) {
    writeJson(response, 404, {
      error: { type: "proxy_route_not_found", message: "Unsupported API-key route." },
    });
    return;
  }

  const credential = resolveApiKey();
  if (!credential) {
    writeJson(response, 503, {
      error: {
        type: "kimi_api_key_missing",
        message: "Kimi API key is not configured. Run ./bin/api-key set.",
      },
    });
    return;
  }

  const controller = new AbortController();
  request.once("aborted", () => controller.abort());
  response.once("close", () => {
    if (!response.writableEnded) controller.abort();
  });
  let body = await readRequestBody(request);
  if (route === "/chat/completions") {
    body = normalizeBody(body, request.headers["content-type"]);
  }
  const upstream = await fetch(`${API_BASE}${route}${requestUrl.search}`, {
    method: request.method,
    headers: upstreamHeaders(request.headers, body, credential.value),
    body: body.length ? body : undefined,
    signal: controller.signal,
  });
  await pipeResponse(upstream, response);
  if (!QUIET) {
    console.error(
      `[kimi-api] ${request.method} ${route} -> ${upstream.status} ${Date.now() - startedAt}ms`,
    );
  }
}

const server = http.createServer((request, response) => {
  handleRequest(request, response).catch((error) => {
    const status = Number(error?.status) || 502;
    console.error(
      `[kimi-api] request failed: ${error instanceof Error ? error.message : String(error)}`,
    );
    if (!response.headersSent) {
      writeJson(response, status, {
        error: {
          type: "kimi_api_proxy_error",
          message: error instanceof Error ? error.message : String(error),
        },
      });
    } else if (!response.writableEnded) {
      response.destroy(error instanceof Error ? error : undefined);
    }
  });
});

server.listen(LISTEN_PORT, LISTEN_HOST, () => {
  console.error(`[kimi-api] listening on http://${LISTEN_HOST}:${LISTEN_PORT}`);
});

for (const signal of ["SIGINT", "SIGTERM"]) {
  process.on(signal, () => server.close(() => process.exit(0)));
}
