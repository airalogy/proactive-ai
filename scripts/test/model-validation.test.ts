import assert from "node:assert/strict";
import test from "node:test";
import { spawnSync } from "node:child_process";
import type { Planner, PlannerOutput } from "@proactive-ai/core";
import { createOpenAICompatiblePlanner } from "@proactive-ai/core/openai-compatible";
import { createBudgetedFetch, runModelValidation } from "../lib/model-validation";

const emptyPlan = (): PlannerOutput => ({
  schema_version: "1",
  immediate_messages: [],
  scheduled_actions: [],
  queue_mutations: [],
  accepted_due_action_ids: [],
  next_pacemaker_seconds: null,
  internal_summary: "Offline harness fixture, not a real model result.",
});
const request = { method: "POST", body: JSON.stringify({ max_completion_tokens: 2048 }) };

for (const script of ["scripts/model-validate.ts", "scripts/model-smoke.ts"]) {
  test(`${script} starts under the repository module configuration without network access`, () => {
    const run = spawnSync(process.execPath, ["--import", "tsx", script], {
      encoding: "utf8",
      env: { ...process.env, LLM_API_KEY: "", LLM_MODEL: "", LLM_BASE_URL: "" },
    });
    assert.equal(run.status, 1);
    assert.match(run.stderr, /LLM_BASE_URL/u);
    assert.doesNotMatch(run.stderr, /Top-level await|Transform failed/u);
  });
}

test("the request cap counts HTTP failures and records available usage", async () => {
  let calls = 0;
  const budget = createBudgetedFetch({
    maxRequests: 2, maxCompletionTokens: 2048,
    fetchImpl: async (_input, init) => {
      calls += 1;
      assert.equal(init?.redirect, "error");
      return calls === 1 ? new Response("error", { status: 500 }) : Response.json({
        model: "fixture-model", usage: { prompt_tokens: 42, completion_tokens: 17 },
      });
    },
  });
  await budget.fetchImpl("https://example.test", request);
  await budget.fetchImpl("https://example.test", request);
  await assert.rejects(() => budget.fetchImpl("https://example.test", request), /budget exhausted/u);
  assert.equal(calls, 2);
  assert.equal(budget.records[0]?.status, 500);
  assert.equal(budget.records[1]?.completion_tokens, 17);
});

test("token limits are checked before any request leaves the process", async () => {
  let calls = 0;
  const budget = createBudgetedFetch({
    maxRequests: 10, maxCompletionTokens: 2048,
    fetchImpl: async () => { calls += 1; return Response.json({}); },
  });
  for (const body of [{}, { max_completion_tokens: 2049 },
    { max_completion_tokens: 2048, max_tokens: 4096 }]) {
    await assert.rejects(() => budget.fetchImpl("https://example.test", {
      ...request, body: JSON.stringify(body),
    }), /completion-token limit/u);
  }
  assert.equal(calls, 0);
});

test("schema-repair retries cannot escape the global request cap", async () => {
  let calls = 0;
  const budget = createBudgetedFetch({
    maxRequests: 1, maxCompletionTokens: 2048,
    fetchImpl: async () => {
      calls += 1;
      return Response.json({ choices: [{ message: { content: "{}" } }] });
    },
  });
  const planner = createOpenAICompatiblePlanner({
    baseUrl: "https://example.test/v1", apiKey: "fixture-key", model: "fixture-model",
    additionalBody: { max_completion_tokens: 2048 }, fetchImpl: budget.fetchImpl,
  });
  const result = await runModelValidation(planner, "2026-10-02T01:00:00.000Z");
  assert.equal(result.ok, false);
  assert.equal(result.steps.length, 1);
  assert.match(result.steps[0]?.error ?? "", /budget exhausted/u);
  assert.equal(calls, 1);
});

test("the six-step harness exercises both branches without injecting model plans", async () => {
  let decisions = 0;
  const planner: Planner = (context) => {
    decisions += 1;
    const plan = emptyPlan();
    if (decisions === 1) {
      plan.immediate_messages = [
        { content: "Take your time.", reason: "fixture" },
        { content: "Let's prepare together.", reason: "fixture" },
      ];
      plan.scheduled_actions = [
        { type: "send_message", content: "Start with three points.", delay_seconds: 600, reason: "fixture" },
        { type: "reconsider", content: null, delay_seconds: 7200, reason: "fixture" },
      ];
    } else if (decisions === 2) {
      plan.accepted_due_action_ids = context.dueQueue.map((action) => action.id);
    } else if (decisions === 3) {
      plan.queue_mutations = context.pendingQueue.map((action) => ({
        operation: "cancel", target_id: action.id, content: null, delay_seconds: null, reason: "fixture",
      }));
      plan.immediate_messages = [{ content: "Understood. Take care.", reason: "fixture" }];
    } else if (context.visibleMessageRequired) {
      plan.immediate_messages = [{ content: "How has your day been?", reason: "fixture" }];
    }
    return plan;
  };
  const result = await runModelValidation(planner, "2026-10-02T01:00:00.000Z");
  assert.equal(result.ok, true);
  assert.equal(decisions, 6);
  assert.equal(result.steps.length, 6);
  assert.equal(result.steps[3]?.messages.length, 0);
  assert.equal(result.steps[5]?.messages.length, 1);
});

test("missing model-generated future actions are reported, never filled by a scripted fallback", async () => {
  const result = await runModelValidation(emptyPlan, "2026-10-02T01:00:00.000Z");
  assert.equal(result.ok, false);
  assert.equal(result.steps.length, 1);
  assert.equal(result.steps[0]?.checks.future_reconsideration, false);
});

test("resuming replays the recorded first plan without calling the provider for it", async () => {
  let calls = 0;
  const plan = emptyPlan();
  plan.scheduled_actions = [
    { type: "send_message", content: "Recorded advice", delay_seconds: 600, reason: "fixture" },
  ];
  const result = await runModelValidation(() => {
    calls += 1;
    throw new Error("Stop this offline fixture after the first new decision");
  }, "2026-10-02T01:00:00.000Z", { initialPlan: plan });
  assert.equal(result.replayed_initial_plan, true);
  assert.equal(result.steps[0]?.outcome, "planned");
  assert.deepEqual(result.steps[0]?.plan, plan);
  assert.equal(result.steps[1]?.outcome, "planner_error");
  assert.equal(calls, 1);
});
