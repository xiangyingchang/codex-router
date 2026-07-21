import assert from "node:assert/strict";
import test from "node:test";

import { renderLiteLlmConfig } from "../src/litellm-config.mjs";
import {
  API_MODELS,
  LISTED_MODELS,
  MODEL_BY_SLUG,
  MODELS,
  PROVIDERS,
} from "../src/model-registry.mjs";

test("provider registry exposes Kimi and every current DeepSeek API model", () => {
  assert.deepEqual(
    LISTED_MODELS.map((model) => model.slug),
    [
      "kimi-oauth/k3",
      "kimi-api/kimi-k3",
      "deepseek/deepseek-v4-flash",
      "deepseek/deepseek-v4-pro",
      "ark-coding/doubao-seed-2.0-code",
      "ark-coding/doubao-seed-2.0-pro",
      "ark-coding/doubao-seed-2.0-lite",
      "ark-coding/doubao-seed-code",
      "ark-coding/minimax-m2.7",
      "ark-coding/minimax-m3",
      "ark-coding/glm-5.2",
      "ark-coding/deepseek-v4-flash",
      "ark-coding/deepseek-v4-pro",
      "ark-coding/kimi-k2.6",
      "ark-coding/kimi-k2.7-code",
    ],
  );
  assert.equal(PROVIDERS.get("deepseek").baseUrl, "https://api.deepseek.com");
  for (const slug of [
    "deepseek/deepseek-v4-flash",
    "deepseek/deepseek-v4-pro",
  ]) {
    const model = MODEL_BY_SLUG.get(slug);
    assert.equal(model.contextWindow, 1_048_576);
    assert.match(model.description, /DeepSeek V4/);
    assert.deepEqual(model.inputModalities, ["text"]);
  }
});

test("deprecated DeepSeek aliases remain routable but stay out of the picker", () => {
  for (const slug of [
    "deepseek/deepseek-chat",
    "deepseek/deepseek-reasoner",
  ]) {
    const model = MODEL_BY_SLUG.get(slug);
    assert.ok(model);
    assert.equal(model.listed, false);
    assert.ok(API_MODELS.includes(model));
  }
});

test("Ark Coding Plan uses its dedicated endpoint and exposes supported model names", () => {
  assert.equal(
    PROVIDERS.get("ark-coding").baseUrl,
    "https://ark.cn-beijing.volces.com/api/coding/v3",
  );
  const arkModels = MODELS.filter((model) => model.provider === "ark-coding");
  assert.deepEqual(
    arkModels.filter((model) => model.listed).map((model) => model.upstreamModel),
    [
      "doubao-seed-2.0-code",
      "doubao-seed-2.0-pro",
      "doubao-seed-2.0-lite",
      "doubao-seed-code",
      "minimax-m2.7",
      "minimax-m3",
      "glm-5.2",
      "deepseek-v4-flash",
      "deepseek-v4-pro",
      "kimi-k2.6",
      "kimi-k2.7-code",
    ],
  );
  assert.equal(MODEL_BY_SLUG.get("ark-coding/glm-latest")?.listed, false);
  assert.equal(MODEL_BY_SLUG.get("ark-coding/glm-latest")?.upstreamModel, "glm-latest");
});

test("LiteLLM configuration is generated from every registry route", () => {
  const rendered = renderLiteLlmConfig();
  for (const model of MODELS) {
    assert.match(rendered, new RegExp(`model_name: "${model.gatewayModel}"`));
  }
  assert.match(rendered, /os\.environ\/CODEX_ROUTER_API_FORWARD_BASE_URL/);
  assert.match(rendered, /os\.environ\/CODEX_ROUTER_INTERNAL_KEY/);
  assert.doesNotMatch(rendered, /DEEPSEEK_API_KEY|KIMI_API_KEY|ARK_CODING_API_KEY/);
});
