import { mkdir, readFile, writeFile } from "node:fs/promises";
import { PlannerOutputSchema, type PlannerOutput } from "@proactive-ai/core";
import { createOpenAICompatiblePlanner, type StructuredOutputMode } from "@proactive-ai/core/openai-compatible";
import { createBudgetedFetch, runModelValidation, VALIDATION_INPUTS } from "./lib/model-validation";

const baseUrl = process.env.LLM_BASE_URL?.trim();
const apiKey = process.env.LLM_API_KEY?.trim();
const model = process.env.LLM_MODEL?.trim();
if (!baseUrl || !apiKey || !model || apiKey.startsWith("replace-") || apiKey.startsWith("your-")) {
  throw new Error("Configure LLM_BASE_URL, LLM_MODEL and the API key in apps/demo/.env.local first.");
}
const endpoint = new URL(baseUrl);
if (endpoint.username || endpoint.password || endpoint.search || endpoint.hash) {
  throw new Error("LLM_BASE_URL must not contain credentials, a query or a fragment");
}
const mode = process.env.LLM_STRUCTURED_OUTPUT ?? "json_object";
if (!["json_schema", "json_object", "prompt"].includes(mode)) {
  throw new Error("Unsupported LLM_STRUCTURED_OUTPUT");
}
const additionalBody = JSON.parse(process.env.LLM_ADDITIONAL_BODY || "{}");
if (!additionalBody || typeof additionalBody !== "object" || Array.isArray(additionalBody)) {
  throw new Error("LLM_ADDITIONAL_BODY must be a JSON object");
}
if ("max_tokens" in additionalBody) {
  throw new Error("This bounded test uses max_completion_tokens; remove max_tokens");
}

// A resumed test may lower, but never raise, the per-run hard cap.
const maxRequests = Number(process.env.MODEL_TEST_MAX_REQUESTS ?? 10);
if (!Number.isSafeInteger(maxRequests) || maxRequests < 1 || maxRequests > 10) {
  throw new Error("MODEL_TEST_MAX_REQUESTS must be an integer from 1 to 10");
}
const maxCompletionTokens = 2048;
const budget = createBudgetedFetch({ maxRequests, maxCompletionTokens });
const planner = createOpenAICompatiblePlanner({
  baseUrl,
  apiKey,
  model,
  structuredOutput: mode as StructuredOutputMode,
  additionalBody: { ...additionalBody, max_completion_tokens: maxCompletionTokens },
  fetchImpl: budget.fetchImpl,
});
async function main() {
  const startedAt = new Date().toISOString();
  let scenarioStartedAt = startedAt;
  let initialPlan: PlannerOutput | undefined;
  const resumeReport = process.env.MODEL_TEST_RESUME_REPORT;
  if (resumeReport) {
    if (!/^tmp\/model-validation\/[\w-]+\.json$/u.test(resumeReport)) {
      throw new Error("Resume report must be a local tmp/model-validation/*.json report");
    }
    const previous = JSON.parse(await readFile(resumeReport, "utf8"));
    const first = previous.steps?.[0];
    const inputs = first?.messages?.filter((m: { role: string }) => m.role === "user")
      .map((m: { content: string }) => m.content);
    if (previous.model !== model || previous.endpoint !== endpoint.origin + endpoint.pathname ||
        previous.structured_output !== mode || previous.replayed_initial_plan ||
        previous.requests?.[0]?.status !== 200 ||
        first?.name !== "initial_batch_and_future_plan" || first.outcome !== "planned" ||
        JSON.stringify(inputs) !== JSON.stringify(VALIDATION_INPUTS) ||
        first.at !== previous.started_at || !Number.isFinite(Date.parse(first.at))) {
      throw new Error("Resume report does not contain a matching original model-generated initial plan");
    }
    initialPlan = PlannerOutputSchema.parse(first.plan);
    scenarioStartedAt = first.at;
  }
  console.log(`Starting bounded real-model validation with ${model}: at most ${maxRequests} requests, ${maxCompletionTokens} completion tokens per request.`);
  const result = await runModelValidation(planner, scenarioStartedAt, {
    initialPlan,
    onStep: (step) => console.log(`${step.name}: ${step.outcome}`),
  });
  const report = {
    ...result,
    model,
    endpoint: endpoint.origin + endpoint.pathname,
    started_at: startedAt,
    scenario_started_at: scenarioStartedAt,
    resumed_from: resumeReport ?? null,
    completed_at: new Date().toISOString(),
    structured_output: mode,
    limits: { max_requests: maxRequests, max_completion_tokens: maxCompletionTokens },
    requests: budget.records,
    scope: "Synthetic user inputs, accelerated event time, real model plans; delivery and cancellation branch from the same initial plan. Not a user study or a day-long background-service test.",
  };
  // Derived local report is ignored by Git. Never record the API key or headers.
  const serialized = JSON.stringify(report, null, 2).split(apiKey!).join("[redacted]");
  await mkdir("tmp/model-validation", { recursive: true });
  const reportPath = `tmp/model-validation/${startedAt.replace(/[:.]/gu, "-")}.json`;
  await writeFile(reportPath, serialized + "\n", { flag: "wx", mode: 0o600 });
  console.log(JSON.stringify({
    ok: result.ok,
    requests: budget.records.length,
    steps: result.steps.map(({ name, outcome, checks, messages }) => ({
      name, outcome, checks,
      visible_messages: messages.filter((message) => message.role === "assistant").length,
    })),
    report: reportPath,
  }, null, 2));
  if (!result.ok) process.exitCode = 1;
}

void main().catch((error: unknown) => {
  console.error((error instanceof Error ? error.message : "Validation failed").split(apiKey!).join("[redacted]"));
  process.exitCode = 1;
});
