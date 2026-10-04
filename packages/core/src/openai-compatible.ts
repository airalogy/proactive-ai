import {
  PlannerOutputSchema,
  PLANNER_JSON_SCHEMA,
  type PlannerOutput,
} from "./protocol";
import type { Planner, PlannerContext } from "./engine";

export type StructuredOutputMode = "json_schema" | "json_object" | "prompt";

export interface OpenAICompatibleConfig {
  baseUrl: string;
  apiKey: string;
  model: string;
  structuredOutput?: StructuredOutputMode;
  temperature?: number;
  timeoutMs?: number;
  maxAttempts?: number;
  additionalBody?: Record<string, unknown>;
  fetchImpl?: typeof fetch;
}

export class PlannerRequestError extends Error {
  readonly status: number | null;

  constructor(message: string, status: number | null = null) {
    super(message);
    this.name = "PlannerRequestError";
    this.status = status;
  }
}

const SYSTEM_PROMPT = `You are the temporal planner for Proactive AI, a research system that models conversation as a revisable timeline rather than a one-turn response.

Return exactly one JSON object that follows the supplied schema. JSON must be valid, with no Markdown fences or surrounding prose.

Behavioral rules:
1. You may return zero, one, or multiple immediate_messages. Silence is a valid decision.
2. Use scheduled_actions for future intentions. delay_seconds is relative to context.now; never invent an absolute execution timestamp.
3. A scheduled send_message is only a proposal and requires nonempty content. It will be rechecked when due. A reconsider action reserves attention without prewriting speech and requires null content.
4. New user messages may invalidate any pending action. Use queue_mutations to cancel, reschedule, or replace stale plans. Cancel requires null content and delay_seconds; reschedule requires a positive delay_seconds and null content; replace requires nonempty content and can target only send_message actions.
5. Every due action id must appear exactly once either in accepted_due_action_ids or as a queue_mutations target. Accept a due send_message only when its prepared text remains appropriate now.
6. Never accept or mutate an id that is not present in the context.
7. A pacemaker is permission to reconsider, not normally an obligation to speak. Prefer silence when there is no grounded, useful reason to contact the user.
8. Every item in new_user_messages arrived as an independent user send. Interpret the ordered messages together as the context available to this decision rather than mechanically answering each one.
9. Match the user's language. Keep user-visible messages natural and concise.
10. When context.visible_message_required is true, the bounded-silence deadline has arrived and external policy permits contact. The plan must therefore produce at least one visible message now, either as an immediate message or by accepting a due send_message.
11. If context.contact_policy.contact_allowed is false and new_user_messages is empty, produce no visible messages: do not accept due send_message actions, and cancel or postpone them instead. Direct replies to new user input remain permitted. Silence does not erase a contact deadline.
12. internal_summary is an audit explanation, not hidden chain-of-thought. State the decision and evidence briefly; do not reveal private reasoning.`;

/**
 * Creates a model-backed planner using the least-common-denominator
 * OpenAI-compatible Chat Completions transport. It works directly with
 * OpenAI, Qwen compatible mode, or an optional LiteLLM proxy.
 */
export function createOpenAICompatiblePlanner(
  config: OpenAICompatibleConfig,
): Planner {
  const fetchImpl = config.fetchImpl ?? globalThis.fetch;
  if (!fetchImpl) throw new Error("No fetch implementation is available");

  const baseUrl = config.baseUrl.replace(/\/+$/u, "");
  if (!baseUrl) throw new Error("baseUrl is required");
  if (!config.apiKey) throw new Error("apiKey is required");
  if (!config.model) throw new Error("model is required");

  const structuredOutput = config.structuredOutput ?? "json_object";
  const maxAttempts = config.maxAttempts ?? 2;
  const timeoutMs = config.timeoutMs ?? 45_000;
  if (!Number.isInteger(maxAttempts) || maxAttempts < 1 || maxAttempts > 3) {
    throw new Error("maxAttempts must be an integer between 1 and 3");
  }

  return async (context) => {
    let previousFailure: string | null = null;
    let previousOutput: string | null = null;

    for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
      const body = createRequestBody({
        config,
        context,
        structuredOutput,
        previousFailure,
        previousOutput,
      });
      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), timeoutMs);

      try {
        const response = await fetchImpl(`${baseUrl}/chat/completions`, {
          method: "POST",
          headers: {
            Authorization: `Bearer ${config.apiKey}`,
            "Content-Type": "application/json",
          },
          body: JSON.stringify(body),
          signal: controller.signal,
        });

        if (!response.ok) {
          const detail = await response.text();
          throw new PlannerRequestError(
            `Planner request failed with HTTP ${response.status}${detail ? `: ${redactSecret(detail, config.apiKey).slice(0, 800)}` : ""}`,
            response.status,
          );
        }

        const payload = (await response.json()) as OpenAIChatCompletion;
        previousOutput = extractText(payload);

        try {
          const parsed = JSON.parse(stripCodeFence(previousOutput)) as unknown;
          return PlannerOutputSchema.parse(parsed);
        } catch (error) {
          previousFailure = redactSecret(compactError(error), config.apiKey);
          if (attempt === maxAttempts) {
            throw new PlannerRequestError(
              `Planner returned invalid structured output after ${maxAttempts} attempt(s): ${previousFailure}`,
            );
          }
        }
      } catch (error) {
        if (error instanceof PlannerRequestError) throw error;
        if (error instanceof Error && error.name === "AbortError") {
          throw new PlannerRequestError(
            `Planner request timed out after ${timeoutMs} ms`,
          );
        }
        throw new PlannerRequestError(
          `Planner request failed: ${redactSecret(compactError(error), config.apiKey)}`,
        );
      } finally {
        clearTimeout(timeout);
      }
    }

    throw new PlannerRequestError("Planner failed without producing a result");
  };
}

export function serializePlannerContext(context: PlannerContext): unknown {
  return {
    now: context.now,
    revision: context.revision,
    trigger: context.trigger,
    new_user_messages: context.newUserMessages.map(serializeMessage),
    recent_messages: context.recentMessages.map(serializeMessage),
    pending_queue: context.pendingQueue.map(serializeQueueAction),
    due_queue: context.dueQueue.map(serializeQueueAction),
    pacemaker: {
      interval_seconds: context.pacemaker.intervalSeconds,
      next_at: context.pacemaker.nextAt,
    },
    contact_policy: {
      enabled: context.contactPolicy.enabled,
      max_silence_seconds: context.contactPolicy.maxSilenceSeconds,
      last_visible_assistant_at:
        context.contactPolicy.lastVisibleAssistantAt,
      deadline_at: context.contactPolicy.deadlineAt,
      contact_allowed: context.contactPolicy.contactAllowed,
    },
    visible_message_required: context.visibleMessageRequired,
  };
}

function createRequestBody(options: {
  config: OpenAICompatibleConfig;
  context: PlannerContext;
  structuredOutput: StructuredOutputMode;
  previousFailure: string | null;
  previousOutput: string | null;
}): Record<string, unknown> {
  const additionalBody = options.config.additionalBody ?? {};
  const reserved = ["model", "messages", "response_format", "stream"];
  for (const key of reserved) {
    if (key in additionalBody) {
      throw new Error(`additionalBody cannot override reserved field ${key}`);
    }
  }

  const repairInstruction = options.previousFailure
    ? `\n\nYour previous output was invalid. Validation error: ${options.previousFailure}\nPrevious output: ${options.previousOutput?.slice(0, 4_000)}\nReturn a corrected JSON object only.`
    : "";
  const messages = [
    {
      role: "system",
      content:
        options.structuredOutput === "json_schema"
          ? SYSTEM_PROMPT
          : `${SYSTEM_PROMPT}\n\nOutput JSON Schema:\n${JSON.stringify(PLANNER_JSON_SCHEMA)}`,
    },
    {
      role: "user",
      content: `Create the next temporal plan from this context:\n${JSON.stringify(serializePlannerContext(options.context))}${repairInstruction}`,
    },
  ];

  const body: Record<string, unknown> = {
    ...additionalBody,
    model: options.config.model,
    messages,
    stream: false,
  };
  // Some reasoning models reject custom sampling parameters. Leave provider
  // defaults intact unless the caller explicitly requests a temperature.
  if (options.config.temperature !== undefined) {
    body.temperature = options.config.temperature;
  }

  if (options.structuredOutput === "json_schema") {
    body.response_format = {
      type: "json_schema",
      json_schema: {
        name: "proactive_ai_plan",
        strict: true,
        schema: PLANNER_JSON_SCHEMA,
      },
    };
  } else if (options.structuredOutput === "json_object") {
    body.response_format = { type: "json_object" };
  }

  return body;
}

function serializeMessage(message: PlannerContext["recentMessages"][number]) {
  return {
    id: message.id,
    role: message.role,
    content: message.content,
    at: message.at,
  };
}

function serializeQueueAction(action: PlannerContext["pendingQueue"][number]) {
  return {
    id: action.id,
    type: action.type,
    content: action.content,
    not_before: action.notBefore,
    reason: action.reason,
    created_at: action.createdAt,
  };
}

function extractText(payload: OpenAIChatCompletion): string {
  const choice = payload.choices?.[0];
  if (choice?.message?.refusal) {
    throw new PlannerRequestError("Planner declined to produce a plan");
  }
  if (choice?.finish_reason && choice.finish_reason !== "stop") {
    throw new PlannerRequestError(
      "Planner response did not finish normally; no plan was accepted",
    );
  }
  const content = choice?.message?.content;
  if (typeof content !== "string" || !content.trim()) {
    throw new PlannerRequestError(
      "Planner response did not contain choices[0].message.content",
    );
  }
  return content.trim();
}

function stripCodeFence(value: string): string {
  const match = value.match(/^```(?:json)?\s*([\s\S]*?)\s*```$/iu);
  return match?.[1]?.trim() ?? value;
}

function compactError(error: unknown): string {
  if (error instanceof Error) return error.message.replace(/\s+/gu, " ").slice(0, 1_000);
  return String(error).replace(/\s+/gu, " ").slice(0, 1_000);
}

function redactSecret(value: string, apiKey: string): string {
  return value.split(apiKey).join("[redacted]");
}

interface OpenAIChatCompletion {
  choices?: Array<{
    finish_reason?: string | null;
    message?: {
      content?: unknown;
      refusal?: unknown;
    };
  }>;
}
