import assert from "node:assert/strict";
import test from "node:test";

import {
  createConversationState,
  receiveUserMessages,
  type PlannerContext,
} from "../src/index";
import {
  createOpenAICompatiblePlanner,
  PlannerRequestError,
} from "../src/openai-compatible";
import { PLANNER_JSON_SCHEMA } from "../src/protocol";

const VALID_PLAN = {
  schema_version: "1",
  immediate_messages: [
    { content: "I saw both messages.", reason: "acknowledge_batch" },
  ],
  scheduled_actions: [],
  queue_mutations: [],
  accepted_due_action_ids: [],
  next_pacemaker_seconds: 1_800,
  internal_summary: "Respond to the batch once.",
};

test("the adapter uses the OpenAI-compatible endpoint and JSON mode", async () => {
  const requests: Array<{ url: string; init?: RequestInit }> = [];
  const fetchImpl: typeof fetch = async (input, init) => {
    requests.push({ url: String(input), init });
    return Response.json({
      choices: [{ message: { content: JSON.stringify(VALID_PLAN) } }],
    });
  };
  const planner = createOpenAICompatiblePlanner({
    baseUrl: "https://example.test/v1/",
    apiKey: "test-key",
    model: "qwen-test",
    fetchImpl,
  });

  const transition = await receiveUserMessages(
    createConversationState({ now: "2026-07-31T01:00:00.000Z" }),
    ["one", "two"],
    planner,
  );

  assert.equal(transition.outcome, "planned");
  assert.equal(requests.length, 1);
  assert.equal(requests[0]?.url, "https://example.test/v1/chat/completions");
  const body = JSON.parse(String(requests[0]?.init?.body)) as Record<
    string,
    unknown
  >;
  assert.equal(body.model, "qwen-test");
  assert.deepEqual(body.response_format, { type: "json_object" });
  assert.match(JSON.stringify(body.messages), /JSON/u);
  assert.match(JSON.stringify(body.messages), /visible_message_required/u);
  assert.match(JSON.stringify(body.messages), /contact_policy/u);
  assert.equal(
    (requests[0]?.init?.headers as Record<string, string>).Authorization,
    "Bearer test-key",
  );
});

test("strict mode sends the portable planner JSON Schema", async () => {
  const requestBodies: Array<Record<string, unknown>> = [];
  const fetchImpl: typeof fetch = async (_input, init) => {
    requestBodies.push(
      JSON.parse(String(init?.body)) as Record<string, unknown>,
    );
    return Response.json({
      choices: [{ message: { content: JSON.stringify(VALID_PLAN) } }],
    });
  };
  const planner = createOpenAICompatiblePlanner({
    baseUrl: "https://api.openai.com/v1",
    apiKey: "test-key",
    model: "test-model",
    structuredOutput: "json_schema",
    fetchImpl,
  });

  await planner(sampleContext());
  const responseFormat = requestBodies[0]?.response_format as {
    type: string;
    json_schema: { strict: boolean; schema: { additionalProperties: boolean } };
  };
  assert.equal(responseFormat.type, "json_schema");
  assert.equal(responseFormat.json_schema.strict, true);
  assert.equal(responseFormat.json_schema.schema.additionalProperties, false);
  assert.equal("temperature" in requestBodies[0]!, false);
});

for (const structuredOutput of ["json_object", "prompt"] as const) {
  test(`${structuredOutput} mode supplies the complete schema in the prompt`, async () => {
    const planner = createOpenAICompatiblePlanner({
      baseUrl: "https://example.test/v1",
      apiKey: "test-key",
      model: "test-model",
      structuredOutput,
      fetchImpl: async (_input, init) => {
        const body = JSON.parse(String(init?.body));
        const schemaText = body.messages[0].content.split("Output JSON Schema:\n")[1];
        assert.deepEqual(JSON.parse(schemaText), PLANNER_JSON_SCHEMA);
        assert.equal(
          "response_format" in body,
          structuredOutput === "json_object",
        );
        return Response.json({
          choices: [{ message: { content: JSON.stringify(VALID_PLAN) } }],
        });
      },
    });
    await planner(sampleContext());
  });
}

test("explicit model parameters are preserved without a forced temperature", async () => {
  const requestBodies: Array<Record<string, unknown>> = [];
  const config = {
    baseUrl: "https://example.test/v1",
    apiKey: "test-key",
    model: "test-model",
    additionalBody: { reasoning_effort: "low", max_completion_tokens: 2048 },
    fetchImpl: (async (_input, init) => {
      requestBodies.push(JSON.parse(String(init?.body)));
      return Response.json({
        choices: [{ message: { content: JSON.stringify(VALID_PLAN) } }],
      });
    }) satisfies typeof fetch,
  };
  await createOpenAICompatiblePlanner(config)(sampleContext());
  await createOpenAICompatiblePlanner({ ...config, temperature: 0.4 })(sampleContext());
  assert.equal("temperature" in requestBodies[0]!, false);
  assert.equal(requestBodies[0]?.reasoning_effort, "low");
  assert.equal(requestBodies[0]?.max_completion_tokens, 2048);
  assert.equal(requestBodies[1]?.temperature, 0.4);
});

for (const failure of ["length", "content_filter", "refusal"] as const) {
  test(`${failure} responses fail closed even if content contains valid JSON`, async () => {
    let requests = 0;
    const planner = createOpenAICompatiblePlanner({
      baseUrl: "https://example.test/v1",
      apiKey: "test-key",
      model: "test-model",
      fetchImpl: async () => {
        requests += 1;
        return Response.json({
          choices: [{
            finish_reason: failure === "refusal" ? "stop" : failure,
            message: {
              content: JSON.stringify(VALID_PLAN),
              refusal: failure === "refusal" ? "Cannot comply" : null,
            },
          }],
        });
      },
    });
    const transition = await receiveUserMessages(
      createConversationState({ now: "2026-07-31T01:00:00.000Z" }),
      ["Hello"],
      planner,
    );
    assert.equal(transition.outcome, "planner_error");
    assert.equal(transition.state.messages.filter((m) => m.role === "assistant").length, 0);
    assert.equal(requests, 1);
  });
}

test("provider errors do not expose an echoed API key", async () => {
  const apiKey = "sk-test-secret-not-a-real-key";
  const planner = createOpenAICompatiblePlanner({
    baseUrl: "https://example.test/v1",
    apiKey,
    model: "test-model",
    fetchImpl: async () => new Response(`Invalid API key: ${apiKey}`, { status: 401 }),
  });
  await assert.rejects(async () => planner(sampleContext()), (error: unknown) => {
    assert.ok(error instanceof PlannerRequestError);
    assert.equal(error.status, 401);
    assert.equal(error.message.includes(apiKey), false);
    assert.match(error.message, /\[redacted\]/u);
    return true;
  });
});

test("malformed model output is repaired with one retry", async () => {
  let callCount = 0;
  const fetchImpl: typeof fetch = async () => {
    callCount += 1;
    return Response.json({
      choices: [
        {
          message: {
            content:
              callCount === 1 ? '{"schema_version":"1"}' : JSON.stringify(VALID_PLAN),
          },
        },
      ],
    });
  };
  const planner = createOpenAICompatiblePlanner({
    baseUrl: "https://example.test/v1",
    apiKey: "test-key",
    model: "qwen-test",
    fetchImpl,
  });

  const result = await planner(sampleContext());
  assert.equal(result.internal_summary, VALID_PLAN.internal_summary);
  assert.equal(callCount, 2);
});

test("transport errors become typed planner failures", async () => {
  const planner = createOpenAICompatiblePlanner({
    baseUrl: "https://example.test/v1",
    apiKey: "test-key",
    model: "qwen-test",
    fetchImpl: async () => new Response("rate limited", { status: 429 }),
  });

  await assert.rejects(
    async () => planner(sampleContext()),
    (error: unknown) =>
      error instanceof PlannerRequestError && error.status === 429,
  );
});

function sampleContext(): PlannerContext {
  const state = createConversationState({
    now: "2026-07-31T01:00:00.000Z",
  });
  return {
    now: state.now,
    revision: state.revision,
    trigger: {
      id: "trigger-test",
      kind: "pacemaker",
      at: state.now,
      userMessageIds: [],
      dueActionIds: [],
    },
    newUserMessages: [],
    recentMessages: [],
    pendingQueue: [],
    dueQueue: [],
    pacemaker: state.pacemaker,
    contactPolicy: state.contactPolicy,
    visibleMessageRequired: false,
  };
}
