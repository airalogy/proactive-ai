import {
  addSeconds,
  configureBoundedSilence,
  createConversationState,
  firePacemaker,
  getPendingQueue,
  processDueQueue,
  receiveUserMessages,
  setProactiveContactAllowed,
  type ConversationState,
  type EngineTransition,
  type Planner,
  type PlannerOutput,
} from "@proactive-ai/core";

export const VALIDATION_INPUTS = [
  "我明天有一个重要面试，有点紧张。",
  "先用两条简短的消息鼓励我，再在10分钟后给我一条准备建议；两小时后再判断要不要继续跟进。",
];

export interface RequestRecord {
  request: number;
  status: number | null;
  duration_ms: number;
  returned_model: string | null;
  prompt_tokens: number | null;
  completion_tokens: number | null;
}

/** Counts network attempts, including schema-repair requests, before dispatch. */
export function createBudgetedFetch(options: {
  maxRequests: number;
  maxCompletionTokens: number;
  fetchImpl?: typeof fetch;
}) {
  if (!Number.isSafeInteger(options.maxRequests) || options.maxRequests < 1 ||
      !Number.isSafeInteger(options.maxCompletionTokens) || options.maxCompletionTokens < 1) {
    throw new Error("Request and token limits must be positive integers");
  }
  const records: RequestRecord[] = [];
  const underlyingFetch = options.fetchImpl ?? globalThis.fetch;
  const fetchImpl: typeof fetch = async (input, init) => {
    if (records.length >= options.maxRequests) {
      throw new Error("Real-model request budget exhausted; no further request sent");
    }
    const body = JSON.parse(String(init?.body));
    if (!Number.isSafeInteger(body.max_completion_tokens) || body.max_completion_tokens < 1 ||
        body.max_completion_tokens > options.maxCompletionTokens || "max_tokens" in body) {
      throw new Error("Request is missing the agreed completion-token limit");
    }
    const record: RequestRecord = {
      request: records.length + 1,
      status: null,
      duration_ms: 0,
      returned_model: null,
      prompt_tokens: null,
      completion_tokens: null,
    };
    records.push(record);
    const start = Date.now();
    try {
      // No automatic network/HTTP retries; adapter repair calls also pass here.
      const response = await underlyingFetch(input, { ...init, redirect: "error" });
      record.status = response.status;
      if (response.ok) {
        try {
          const payload = await response.clone().json();
          record.returned_model = typeof payload.model === "string" ? payload.model : null;
          record.prompt_tokens = tokenCount(payload.usage?.prompt_tokens);
          record.completion_tokens = tokenCount(payload.usage?.completion_tokens);
        } catch {
          // Parsing/validation belongs to the adapter, not the usage recorder.
        }
      }
      return response;
    } finally {
      record.duration_ms = Date.now() - start;
    }
  };
  return { fetchImpl, records };
}

function tokenCount(value: unknown): number | null {
  return typeof value === "number" && Number.isSafeInteger(value) && value >= 0 ? value : null;
}

export interface ValidationStep {
  name: string;
  outcome: EngineTransition["outcome"];
  checks: Record<string, boolean>;
  error: string | null;
  at: string;
  messages: Array<{ role: string; content: string; at: string }>;
  plan: EngineTransition["plan"];
  queue: ConversationState["queue"];
  contact_policy: ConversationState["contactPolicy"];
}

/** Synthetic inputs and accelerated timestamps; every candidate comes from planner. */
export async function runModelValidation(planner: Planner, start: string, options?: {
  initialPlan?: PlannerOutput;
  onStep?: (step: ValidationStep) => void;
}) {
  const steps: ValidationStep[] = [];
  const record = (name: string, before: ConversationState, transition: EngineTransition,
    checks: Record<string, boolean> = {}) => {
    const previousIds = new Set(before.messages.map((message) => message.id));
    steps.push({
      name,
      outcome: transition.outcome,
      checks: { valid_transition: transition.outcome === "planned", ...checks },
      error: transition.error,
      at: transition.state.now,
      messages: transition.state.messages.filter((message) => !previousIds.has(message.id))
        .map(({ role, content, at }) => ({ role, content, at })),
      plan: transition.plan,
      queue: transition.state.queue,
      contact_policy: transition.state.contactPolicy,
    });
    options?.onStep?.(steps.at(-1)!);
  };
  const result = () => ({
    ok: steps.length === 6 && steps.every((step) => Object.values(step.checks).every(Boolean)),
    expected_steps: 6,
    replayed_initial_plan: options?.initialPlan !== undefined,
    steps,
  });

  const initial = createConversationState({ now: start });
  const savedPlan = options?.initialPlan;
  const first = await receiveUserMessages(initial, VALIDATION_INPUTS,
    savedPlan ? () => savedPlan : planner);
  const pending = getPendingQueue(first.state);
  record("initial_batch_and_future_plan", initial, first, {
    multiple_visible_messages: visibleCount(first) >= 2,
    prepared_send: pending.some((action) => action.type === "send_message"),
    future_reconsideration: pending.some((action) => action.type === "reconsider"),
  });
  if (first.outcome !== "planned" || pending.length === 0) return result();

  // Two continuations from the same real model plan: unchanged vs cancelled.
  const send = pending.find((action) => action.type === "send_message");
  if (send) {
    const delivered = await processDueQueue(first.state, planner, send.notBefore);
    record("unchanged_context_delivery_branch", first.state, delivered, {
      prepared_send_delivered: delivered.state.queue.some((action) =>
        action.id === send.id && action.status === "delivered"),
    });
    if (delivered.outcome !== "planned") return result();
  } else {
    // Do not seed a fabricated send and claim that the model planned it.
    return result();
  }

  const cancellationAt = new Date(Math.min(
    Date.parse(start) + 300_000, Date.parse(pending[0]!.notBefore) - 1,
  )).toISOString();
  const cancelled = await receiveUserMessages(first.state, [
    "刚收到通知，面试取消了，不用准备了，也请取消刚才安排的准备建议和跟进。先聊到这儿，拜拜。",
  ], planner, cancellationAt);
  const oldIds = new Set(pending.map((action) => action.id));
  record("changed_context_cancellation_branch", first.state, cancelled, {
    old_actions_cancelled: cancelled.state.queue.filter((action) => oldIds.has(action.id))
      .every((action) => action.status === "cancelled"),
  });
  if (cancelled.outcome !== "planned") return result();

  const bounded = configureBoundedSilence(cancelled.state, 86_400);
  const pulse = await firePacemaker(bounded, planner, addSeconds(bounded.now, 3_600));
  record("pacemaker_before_deadline", bounded, pulse);
  // Both speech and deliberate silence are valid here; the report shows which occurred.
  if (pulse.outcome !== "planned") return result();

  const pausedState = setProactiveContactAllowed(pulse.state, false);
  const deadline = pausedState.contactPolicy.deadlineAt!;
  const paused = await firePacemaker(pausedState, planner, deadline);
  record("contact_paused_at_deadline", pausedState, paused, {
    no_visible_output: visibleCount(paused) === 0,
    deadline_preserved: paused.state.contactPolicy.deadlineAt === deadline,
  });
  if (paused.outcome !== "planned") return result();

  const resumedState = setProactiveContactAllowed(paused.state, true);
  const renewed = await firePacemaker(resumedState, planner, resumedState.now);
  record("autonomous_contact_after_resume", resumedState, renewed, {
    no_new_user_input: renewed.trigger.userMessageIds.length === 0,
    visible_contact: visibleCount(renewed) > 0,
    deadline_renewed: Date.parse(renewed.state.contactPolicy.deadlineAt ?? "") > Date.parse(deadline),
  });
  return result();
}

function visibleCount(transition: EngineTransition): number {
  return transition.state.messages.filter((message) =>
    message.role === "assistant" && message.triggerId === transition.trigger.id).length;
}
