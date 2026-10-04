import {
  advanceTime,
  appendUserMessages,
  createConversationState,
  deliberatePendingUserMessages,
  receiveUserMessages,
  type ConversationState,
  type Planner,
  type PlannerOutput,
} from "@proactive-ai/core";

import { translations, type Language } from "../i18n";

export type DemoLanguage = Language;
export const GUIDED_START = "2026-07-31T09:00:00.000Z";
export const GUIDED_STEP_TIMES = [
  GUIDED_START,
  "2026-07-31T09:00:05.000Z",
  "2026-07-31T09:45:00.000Z",
  "2026-07-31T15:00:00.000Z",
  "2026-08-02T09:45:00.000Z",
] as const;

// Delay before each next step, indexed by completed steps. Give the
// cancellation an extra second; there is no timer after the final step.
export const GUIDED_PLAYBACK_DELAYS_MS = [200, 2_000, 2_000, 3_000, 2_000] as const;

export const guidedCopy = {
  en: translations.en.guided.steps,
  zh: translations.zh.guided.steps,
};

export function createGuidedState(): ConversationState {
  return createConversationState({
    now: GUIDED_START,
    pacemakerIntervalSeconds: 21_600,
    boundedSilenceSeconds: 172_800,
  });
}

// Only the proposals and external events are scripted. Validation, queue
// changes, delivery, silence, and deadline renewal run through the core engine.
export function createGuidedPlanner(language: DemoLanguage): Planner {
  const text = translations[language].guided;
  return (context) => {
    const plan: PlannerOutput = {
      schema_version: "1",
      immediate_messages: [],
      scheduled_actions: [],
      queue_mutations: [],
      accepted_due_action_ids: [],
      next_pacemaker_seconds: 21_600,
      internal_summary: text.waitingSummary,
    };
    if (context.newUserMessages.length === 2) {
      plan.immediate_messages = [{
        content: text.acknowledgement,
        reason: "acknowledge_context",
      }];
      plan.scheduled_actions = [
        { type: "send_message", delay_seconds: 5, content: text.continuation, reason: "short_continuation" },
        { type: "send_message", delay_seconds: 7_200, content: text.preparation, reason: "interview_preparation" },
        { type: "reconsider", delay_seconds: 86_400, content: null, reason: "reconsider_interview_follow_up" },
      ];
      plan.internal_summary = text.initialSummary;
    } else if (context.newUserMessages.length > 0) {
      plan.immediate_messages = [{
        content: text.cancellationReply,
        reason: "respond_to_changed_context",
      }];
      plan.queue_mutations = context.pendingQueue.map((action) => ({
        operation: "cancel", target_id: action.id, delay_seconds: null, content: null,
        reason: text.cancellationReason,
      }));
      plan.next_pacemaker_seconds = 18_900;
      plan.internal_summary = text.cancellationSummary;
    } else if (context.dueQueue.length > 0) {
      plan.accepted_due_action_ids = context.dueQueue.map((action) => action.id);
      plan.internal_summary = text.deliverySummary;
    } else if (context.visibleMessageRequired) {
      plan.immediate_messages = [{
        content: text.reconnection,
        reason: "reopen_after_quiet_interval",
      }];
      plan.internal_summary = text.reconnectionSummary;
    } else {
      plan.next_pacemaker_seconds = Math.max(10, Math.ceil(
        (Date.parse(context.contactPolicy.deadlineAt!) - Date.parse(context.now)) / 1_000,
      ));
      plan.internal_summary = text.silenceSummary;
    }
    return plan;
  };
}

export async function runGuidedStep(
  state: ConversationState,
  step: number,
  language: DemoLanguage,
): Promise<ConversationState> {
  if (!Number.isInteger(step) || step < 0 || step >= GUIDED_STEP_TIMES.length) {
    throw new Error("Invalid guided-demo step");
  }
  const expectedTime = step === 0 ? GUIDED_START : GUIDED_STEP_TIMES[step - 1];
  const expectedMessageCount = [0, 3, 4, 6, 6][step];
  if (state.now !== expectedTime || state.messages.length !== expectedMessageCount) {
    throw new Error("Guided-demo steps must run once, in order");
  }
  const planner = createGuidedPlanner(language);
  const at = GUIDED_STEP_TIMES[step];
  if (step === 0) {
    const messages = translations[language].guided.userMessages;
    let arrivals = state;
    for (const content of messages) arrivals = appendUserMessages(arrivals, [content], at);
    const result = await deliberatePendingUserMessages(arrivals, planner);
    if (result.outcome !== "planned") throw new Error(result.error ?? "Guided plan failed");
    return result.state;
  }
  if (step === 2) {
    const result = await receiveUserMessages(state, [translations[language].guided.cancellation], planner, at);
    if (result.outcome !== "planned") throw new Error(result.error ?? "Guided plan failed");
    return result.state;
  }
  const result = await advanceTime(state, at, planner);
  if (result.transitions.some((transition) => transition.outcome !== "planned")) {
    throw new Error("Guided transition failed validation");
  }
  return result.state;
}
