import assert from "node:assert/strict";

import {
  createConversationState,
  receiveUserMessages,
} from "@proactive-ai/core";
import {
  createOpenAICompatiblePlanner,
  type StructuredOutputMode,
} from "@proactive-ai/core/openai-compatible";

const baseUrl = process.env.LLM_BASE_URL?.trim();
const apiKey = process.env.LLM_API_KEY?.trim();
const model = process.env.LLM_MODEL?.trim();

if (!baseUrl || !apiKey || !model) {
  throw new Error(
    "Set LLM_BASE_URL, LLM_API_KEY, and LLM_MODEL, or create apps/demo/.env.local from .env.example.",
  );
}

const structuredOutput = parseStructuredOutput(
  process.env.LLM_STRUCTURED_OUTPUT,
);
const additionalBody = parseAdditionalBody(process.env.LLM_ADDITIONAL_BODY);
const planner = createOpenAICompatiblePlanner({
  baseUrl,
  apiKey,
  model,
  structuredOutput,
  additionalBody,
});

async function main() {
  const transition = await receiveUserMessages(
    createConversationState({ now: "2026-07-31T01:00:00.000Z" }),
    ["我明天有一个重要面试。", "我有点紧张，还没有开始准备。"],
    planner,
  );

  assert.equal(
    transition.outcome,
    "planned",
    transition.error ?? "The model-backed planner did not produce a valid plan",
  );
  assert.ok(transition.plan);

  console.log(
    JSON.stringify(
      {
        ok: true,
        model,
        protocol: "openai-compatible/chat-completions",
        structured_output: structuredOutput,
        immediate_messages: transition.plan.immediate_messages.length,
        scheduled_actions: transition.plan.scheduled_actions.length,
        queue_mutations: transition.plan.queue_mutations.length,
        next_pacemaker_seconds: transition.plan.next_pacemaker_seconds,
      },
      null,
      2,
    ),
  );
}

void main().catch((error: unknown) => {
  console.error((error instanceof Error ? error.message : "Smoke test failed").split(apiKey!).join("[redacted]"));
  process.exitCode = 1;
});

function parseStructuredOutput(
  value: string | undefined,
): StructuredOutputMode {
  if (value === "json_schema" || value === "prompt") return value;
  return "json_object";
}

function parseAdditionalBody(
  value: string | undefined,
): Record<string, unknown> | undefined {
  if (!value?.trim()) return undefined;
  const parsed = JSON.parse(value) as unknown;
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
    throw new Error("LLM_ADDITIONAL_BODY must be a JSON object");
  }
  return parsed as Record<string, unknown>;
}
