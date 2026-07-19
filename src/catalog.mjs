import { execFileSync } from "node:child_process";
import {
  chmodSync,
  existsSync,
  mkdirSync,
  readFileSync,
  renameSync,
  writeFileSync,
} from "node:fs";
import path from "node:path";

import {
  CONFIG_PATH,
  MERGED_CATALOG_PATH,
  NATIVE_CATALOG_PATH,
  STATE_DIR,
} from "./paths.mjs";

const refresh = process.argv.includes("--refresh-native");
const bundled = process.argv.includes("--bundled-native");

function codexBinary() {
  const candidates = [
    process.env.CODEX_BIN,
    "/Applications/ChatGPT.app/Contents/Resources/codex",
    "/Applications/Codex.app/Contents/Resources/codex",
    "/opt/homebrew/bin/codex",
    "/usr/local/bin/codex",
  ].filter(Boolean);
  return candidates.find(existsSync) || "codex";
}

function atomicJson(target, value) {
  mkdirSync(path.dirname(target), { recursive: true, mode: 0o700 });
  const temporary = `${target}.tmp.${process.pid}`;
  writeFileSync(temporary, `${JSON.stringify(value, null, 2)}\n`, {
    encoding: "utf8",
    mode: 0o600,
  });
  chmodSync(temporary, 0o600);
  renameSync(temporary, target);
}

function captureNative() {
  const args = ["debug", "models"];
  if (bundled) args.push("--bundled");
  let output;
  try {
    output = execFileSync(codexBinary(), args, {
      encoding: "utf8",
      timeout: 30_000,
      maxBuffer: 32 * 1024 * 1024,
    });
  } catch (error) {
    if (bundled) throw error;
    output = execFileSync(codexBinary(), ["debug", "models", "--bundled"], {
      encoding: "utf8",
      timeout: 30_000,
      maxBuffer: 32 * 1024 * 1024,
    });
  }
  const parsed = JSON.parse(output);
  if (!parsed || !Array.isArray(parsed.models) || parsed.models.length === 0) {
    throw new Error("Codex returned an empty or invalid model catalog.");
  }
  if (parsed.models.some((model) => String(model.slug).startsWith("kimi-"))) {
    throw new Error(
      "Refusing to capture an already-merged catalog. Disable the router before refreshing native models.",
    );
  }
  atomicJson(NATIVE_CATALOG_PATH, { models: parsed.models });
  return parsed;
}

function nativeCatalog() {
  if (!existsSync(NATIVE_CATALOG_PATH) || refresh) return captureNative();
  const parsed = JSON.parse(readFileSync(NATIVE_CATALOG_PATH, "utf8"));
  if (!parsed || !Array.isArray(parsed.models) || parsed.models.length === 0) {
    return captureNative();
  }
  return parsed;
}

function selectedModel() {
  if (!existsSync(CONFIG_PATH)) return undefined;
  const config = readFileSync(CONFIG_PATH, "utf8");
  const firstTable = config.search(/^\s*\[/m);
  const root = firstTable === -1 ? config : config.slice(0, firstTable);
  return root.match(/^\s*model\s*=\s*["']([^"']+)["']/m)?.[1];
}

function reasoning(effort, description) {
  return { effort, description };
}

function routedModel(template, options) {
  return {
    ...template,
    slug: options.slug,
    display_name: options.displayName,
    description: options.description,
    priority: options.priority,
    visibility: "list",
    supported_in_api: true,
    default_reasoning_level: options.defaultEffort,
    supported_reasoning_levels: options.reasoningLevels,
    context_window: options.contextWindow,
    max_context_window: options.contextWindow,
    effective_context_window_percent: 95,
    auto_compact_token_limit: options.autoCompact,
    input_modalities: ["text", "image"],
    comp_hash: options.compHash,
    additional_speed_tiers: [],
    service_tiers: [],
    availability_nux: null,
    upgrade: null,
    supports_reasoning_summaries: false,
    default_reasoning_summary: "none",
    support_verbosity: false,
    default_verbosity: null,
    supports_search_tool: false,
    supports_image_detail_original: false,
    use_responses_lite: false,
    multi_agent_version: "v1",
  };
}

const native = nativeCatalog();
const template =
  native.models.find((model) => model.slug === "gpt-5.5") ||
  native.models.find((model) => model.visibility === "list") ||
  native.models[0];
const models = new Map(native.models.map((model) => [model.slug, model]));

models.set(
  "kimi-oauth/k3",
  routedModel(template, {
    slug: "kimi-oauth/k3",
    displayName: "Kimi K3 (OAuth)",
    description: "Kimi K3 using the existing Kimi Code CLI OAuth session.",
    priority: 4,
    defaultEffort: "high",
    reasoningLevels: [
      reasoning("low", "Faster reasoning"),
      reasoning("high", "Balanced deep reasoning"),
      reasoning("max", "Maximum reasoning depth"),
    ],
    contextWindow: 262_144,
    autoCompact: 235_000,
    compHash: "kimi-oauth-k3-v1",
  }),
);

models.set(
  "kimi-api/kimi-k3",
  routedModel(template, {
    slug: "kimi-api/kimi-k3",
    displayName: "Kimi K3 (API)",
    description: "Kimi K3 using a separately billed Kimi Platform API key.",
    priority: 5,
    defaultEffort: "max",
    reasoningLevels: [
      reasoning("max", "Maximum reasoning required by the Kimi K3 API"),
    ],
    contextWindow: 1_048_576,
    autoCompact: 900_000,
    compHash: "kimi-api-k3-v1",
  }),
);

const merged = [...models.values()].sort((left, right) => {
  const priority = Number(left.priority ?? 999) - Number(right.priority ?? 999);
  return priority || String(left.slug).localeCompare(String(right.slug));
});
atomicJson(MERGED_CATALOG_PATH, { models: merged });
process.stdout.write(
  `${JSON.stringify({
    path: MERGED_CATALOG_PATH,
    models: merged.length,
    selected_model: selectedModel() || null,
  })}\n`,
);
