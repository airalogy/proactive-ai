import {
  createOpenAICompatiblePlanner,
  type OpenAICompatibleConfig,
  type StructuredOutputMode,
} from "@proactive-ai/core/openai-compatible";
import type { PlannerContext } from "@proactive-ai/core";

export const runtime = "edge";

export async function GET() {
  const config = readConfiguration();
  return Response.json({
    configured: config !== null,
    model: config?.model ?? null,
    protocol: "openai-compatible/chat-completions",
  });
}

export async function POST(request: Request) {
  const config = readConfiguration();
  if (!config) {
    return Response.json(
      {
        error:
          "Model mode is not configured. Set LLM_BASE_URL, LLM_API_KEY, and LLM_MODEL on the server.",
      },
      { status: 503 },
    );
  }

  let context: PlannerContext;
  try {
    context = (await request.json()) as PlannerContext;
    assertPlannerContext(context);
  } catch (error) {
    return Response.json(
      { error: error instanceof Error ? error.message : "Invalid context" },
      { status: 400 },
    );
  }

  try {
    const planner = createOpenAICompatiblePlanner(config);
    const plan = await planner(context);
    return Response.json({ plan });
  } catch (error) {
    return Response.json(
      {
        error:
          error instanceof Error ? error.message : "The model planner failed",
      },
      { status: 502 },
    );
  }
}

function readConfiguration(): OpenAICompatibleConfig | null {
  const baseUrl = process.env.LLM_BASE_URL?.trim();
  const apiKey = process.env.LLM_API_KEY?.trim();
  const model = process.env.LLM_MODEL?.trim();
  if (!baseUrl || !apiKey || !model) return null;

  const structuredOutput = parseStructuredOutput(
    process.env.LLM_STRUCTURED_OUTPUT,
  );
  const additionalBody = parseAdditionalBody(process.env.LLM_ADDITIONAL_BODY);

  return {
    baseUrl,
    apiKey,
    model,
    structuredOutput,
    additionalBody,
  };
}

function parseStructuredOutput(value: string | undefined): StructuredOutputMode {
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

function assertPlannerContext(value: unknown): asserts value is PlannerContext {
  if (!value || typeof value !== "object") {
    throw new Error("Request body must be a planner context object");
  }
  const context = value as Partial<PlannerContext>;
  if (
    typeof context.now !== "string" ||
    typeof context.revision !== "number" ||
    !context.trigger ||
    !Array.isArray(context.newUserMessages) ||
    !Array.isArray(context.recentMessages) ||
    !Array.isArray(context.pendingQueue) ||
    !Array.isArray(context.dueQueue) ||
    !context.pacemaker ||
    !context.contactPolicy ||
    typeof context.visibleMessageRequired !== "boolean"
  ) {
    throw new Error("Request body is missing required planner context fields");
  }
}
