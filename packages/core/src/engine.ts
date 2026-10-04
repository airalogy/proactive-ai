import {
  PlannerOutputSchema,
  type PlannerOutput,
  type TriggerKind,
} from "./protocol";

export type MessageRole = "user" | "assistant";
export type QueueActionType = "send_message" | "reconsider";
export type QueueActionStatus =
  | "pending"
  | "delivered"
  | "cancelled"
  | "consumed";

export interface ConversationMessage {
  id: string;
  role: MessageRole;
  content: string;
  at: string;
  reason: string | null;
  triggerId: string | null;
}

export interface QueueAction {
  id: string;
  type: QueueActionType;
  content: string | null;
  notBefore: string;
  reason: string;
  createdAt: string;
  createdByTriggerId: string;
  status: QueueActionStatus;
  resolvedAt: string | null;
  resolutionReason: string | null;
}

export type EngineLogKind =
  | "trigger"
  | "plan"
  | "queue"
  | "delivery"
  | "policy"
  | "silence"
  | "error";

export interface EngineLogEntry {
  id: string;
  kind: EngineLogKind;
  at: string;
  title: string;
  detail: string;
  triggerId: string | null;
}

export interface PacemakerState {
  intervalSeconds: number;
  nextAt: string;
}

export interface ProactiveContactPolicyState {
  enabled: boolean;
  maxSilenceSeconds: number | null;
  lastVisibleAssistantAt: string | null;
  deadlineAt: string | null;
  contactAllowed: boolean;
}

export interface ConversationState {
  schemaVersion: "1";
  now: string;
  revision: number;
  sequence: number;
  messages: ConversationMessage[];
  queue: QueueAction[];
  log: EngineLogEntry[];
  pacemaker: PacemakerState;
  contactPolicy: ProactiveContactPolicyState;
}

export interface DeliberationTrigger {
  id: string;
  kind: TriggerKind;
  at: string;
  userMessageIds: string[];
  dueActionIds: string[];
}

export interface PlannerContext {
  now: string;
  revision: number;
  trigger: DeliberationTrigger;
  newUserMessages: ConversationMessage[];
  recentMessages: ConversationMessage[];
  pendingQueue: QueueAction[];
  dueQueue: QueueAction[];
  pacemaker: PacemakerState;
  contactPolicy: ProactiveContactPolicyState;
  visibleMessageRequired: boolean;
}

export type Planner = (
  context: PlannerContext,
) => PlannerOutput | Promise<PlannerOutput>;

export interface EngineTransition {
  state: ConversationState;
  trigger: DeliberationTrigger;
  plan: PlannerOutput | null;
  outcome: "planned" | "planner_error";
  error: string | null;
}

export interface AdvanceResult {
  state: ConversationState;
  transitions: EngineTransition[];
}

export interface ConversationCoordinatorOptions {
  coalesceWindowMs?: number;
}

interface CoordinatorWaiter {
  resolve: (transition: EngineTransition) => void;
  reject: (error: unknown) => void;
}

const MAX_RECENT_MESSAGES = 40;
const FAILURE_RETRY_SECONDS = 60;
const MAX_ADVANCE_TRANSITIONS = 200;

export function createConversationState(options?: {
  now?: string | Date;
  pacemakerIntervalSeconds?: number;
  boundedSilenceSeconds?: number | null;
  proactiveContactAllowed?: boolean;
}): ConversationState {
  const now = toIso(options?.now ?? new Date());
  const intervalSeconds = options?.pacemakerIntervalSeconds ?? 1_800;
  const boundedSilenceSeconds = options?.boundedSilenceSeconds ?? null;
  assertPositiveInteger(intervalSeconds, "pacemakerIntervalSeconds");
  if (boundedSilenceSeconds !== null) {
    assertPositiveInteger(boundedSilenceSeconds, "boundedSilenceSeconds");
  }

  const state: ConversationState = {
    schemaVersion: "1",
    now,
    revision: 0,
    sequence: 0,
    messages: [],
    queue: [],
    log: [],
    pacemaker: {
      intervalSeconds,
      nextAt: addSeconds(now, intervalSeconds),
    },
    contactPolicy: {
      enabled: boundedSilenceSeconds !== null,
      maxSilenceSeconds: boundedSilenceSeconds,
      lastVisibleAssistantAt: null,
      deadlineAt:
        boundedSilenceSeconds === null
          ? null
          : addSeconds(now, boundedSilenceSeconds),
      contactAllowed: options?.proactiveContactAllowed ?? true,
    },
  };

  alignPacemakerWithContactDeadline(state);
  return state;
}

export function configureBoundedSilence(
  state: ConversationState,
  maxSilenceSeconds: number | null,
  at: string | Date = state.now,
): ConversationState {
  if (maxSilenceSeconds !== null) {
    assertPositiveInteger(maxSilenceSeconds, "maxSilenceSeconds");
  }

  const next = cloneStateAt(state, at);
  next.contactPolicy.enabled = maxSilenceSeconds !== null;
  next.contactPolicy.maxSilenceSeconds = maxSilenceSeconds;
  next.contactPolicy.deadlineAt =
    maxSilenceSeconds === null
      ? null
      : addSeconds(next.now, maxSilenceSeconds);
  alignPacemakerWithContactDeadline(next);
  pushLog(
    next,
    "policy",
    maxSilenceSeconds === null
      ? "Bounded silence disabled"
      : "Bounded silence configured",
    maxSilenceSeconds === null
      ? "The proactive contact deadline was cleared."
      : `The next contact deadline is ${next.contactPolicy.deadlineAt}.`,
    null,
  );
  next.revision += 1;
  return next;
}

export function setProactiveContactAllowed(
  state: ConversationState,
  allowed: boolean,
  at: string | Date = state.now,
): ConversationState {
  const next = cloneStateAt(state, at);
  next.contactPolicy.contactAllowed = allowed;
  alignPacemakerWithContactDeadline(next);
  pushLog(
    next,
    "policy",
    allowed ? "Proactive contact allowed" : "Proactive contact paused",
    allowed
      ? "The external policy gate permits proactive contact."
      : "The external policy gate temporarily blocks proactive contact without clearing its deadline.",
    null,
  );
  next.revision += 1;
  return next;
}

export function isVisibleMessageRequired(
  state: ConversationState,
  at: string | Date = state.now,
): boolean {
  const policy = state.contactPolicy;
  return (
    policy.enabled &&
    policy.contactAllowed &&
    policy.deadlineAt !== null &&
    toMillis(at) >= toMillis(policy.deadlineAt)
  );
}

export function getPendingQueue(state: ConversationState): QueueAction[] {
  return state.queue
    .filter((action) => action.status === "pending")
    .sort(compareQueueActions);
}

export function getDueQueue(
  state: ConversationState,
  at: string | Date = state.now,
): QueueAction[] {
  const timestamp = toMillis(at);
  return getPendingQueue(state).filter(
    (action) => toMillis(action.notBefore) <= timestamp,
  );
}

export async function receiveUserMessages(
  state: ConversationState,
  contents: string[],
  planner: Planner,
  at: string | Date = state.now,
): Promise<EngineTransition> {
  return deliberatePendingUserMessages(
    appendUserMessages(state, contents, at),
    planner,
  );
}

/**
 * Records user-message arrivals without assuming that each arrival maps to a
 * separate model invocation. Messages remain unprocessed until a valid plan
 * based on their decision snapshot is committed.
 */
export function appendUserMessages(
  state: ConversationState,
  contents: string[],
  at: string | Date = state.now,
): ConversationState {
  const normalized = contents.map((content) => content.trim()).filter(Boolean);
  if (normalized.length === 0) {
    throw new Error("appendUserMessages requires at least one non-empty message");
  }

  const next = cloneStateAt(state, at);

  for (const content of normalized) {
    const id = allocateId(next, "msg");
    next.messages.push({
      id,
      role: "user",
      content,
      at: next.now,
      reason: null,
      triggerId: null,
    });
  }

  next.revision += 1;
  return next;
}

/**
 * Creates one decision snapshot from every user message that has arrived but
 * has not yet been handled by a committed plan.
 */
export async function deliberatePendingUserMessages(
  state: ConversationState,
  planner: Planner,
): Promise<EngineTransition> {
  const messageIds = state.messages
    .filter((message) => message.role === "user" && message.triggerId === null)
    .map((message) => message.id);
  if (messageIds.length === 0) {
    throw new Error(
      "deliberatePendingUserMessages requires at least one unprocessed user message",
    );
  }
  return deliberate(state, "user_message", planner);
}

/**
 * Coordinates real-time user input around the pure timeline engine. Every
 * call records one independent arrival and requests deliberation. Arrivals
 * within the coalescing window share one snapshot. If another message arrives
 * while a planner is running, the candidate based on the older revision is
 * discarded and all still-unprocessed messages are planned together. Failed
 * decisions return their recovery state to the caller; the scheduled wakeup,
 * rather than this input-coalescing loop, drives a later retry.
 */
export class ConversationCoordinator {
  private state: ConversationState;
  private planner: Planner;
  private readonly coalesceWindowMs: number;
  private timer: ReturnType<typeof setTimeout> | null = null;
  private running = false;
  private waiters: CoordinatorWaiter[] = [];

  constructor(
    state: ConversationState,
    planner: Planner,
    options: ConversationCoordinatorOptions = {},
  ) {
    const coalesceWindowMs = options.coalesceWindowMs ?? 350;
    if (!Number.isInteger(coalesceWindowMs) || coalesceWindowMs < 0) {
      throw new Error("coalesceWindowMs must be a non-negative integer");
    }
    this.state = cloneState(state);
    this.planner = planner;
    this.coalesceWindowMs = coalesceWindowMs;
  }

  getState(): ConversationState {
    return cloneState(this.state);
  }

  setPlanner(planner: Planner): void {
    this.planner = planner;
  }

  receiveUserMessage(
    content: string,
    at: string | Date = this.state.now,
  ): Promise<EngineTransition> {
    this.state = appendUserMessages(this.state, [content], at);
    const result = new Promise<EngineTransition>((resolve, reject) => {
      this.waiters.push({ resolve, reject });
    });
    this.scheduleDecision();
    return result;
  }

  private scheduleDecision(): void {
    if (this.running || this.timer !== null) return;
    this.timer = setTimeout(() => {
      this.timer = null;
      void this.drain();
    }, this.coalesceWindowMs);
  }

  private async drain(): Promise<void> {
    if (this.running) return;
    this.running = true;
    let finalTransition: EngineTransition | null = null;

    try {
      while (hasUnprocessedUserMessages(this.state)) {
        const snapshot = cloneState(this.state);
        const transition = await deliberatePendingUserMessages(
          snapshot,
          this.planner,
        );

        if (this.state.revision !== snapshot.revision) {
          pushLog(
            this.state,
            "plan",
            "Stale plan discarded",
            `The planner observed revision ${snapshot.revision}, but revision ${this.state.revision} was current before commit. The candidate produced no visible output and will be replanned with the new input.`,
            transition.trigger.id,
          );
          continue;
        }

        this.state = transition.state;
        finalTransition = transition;
        if (transition.outcome === "planner_error") break;
      }

      if (finalTransition === null) {
        throw new Error("no pending user-message decision was available");
      }
      const waiters = this.waiters.splice(0);
      for (const waiter of waiters) waiter.resolve(finalTransition);
    } catch (error) {
      const waiters = this.waiters.splice(0);
      for (const waiter of waiters) waiter.reject(error);
    } finally {
      this.running = false;
      if (
        finalTransition?.outcome !== "planner_error" &&
        hasUnprocessedUserMessages(this.state)
      ) {
        this.scheduleDecision();
      }
    }
  }
}

export async function firePacemaker(
  state: ConversationState,
  planner: Planner,
  at: string | Date = state.now,
): Promise<EngineTransition> {
  return deliberate(cloneStateAt(state, at), "pacemaker", planner);
}

export async function processDueQueue(
  state: ConversationState,
  planner: Planner,
  at: string | Date = state.now,
): Promise<EngineTransition> {
  const next = cloneStateAt(state, at);
  if (getDueQueue(next).length === 0) {
    throw new Error("processDueQueue requires at least one due queue action");
  }
  return deliberate(next, "queue_due", planner);
}

export async function advanceTime(
  state: ConversationState,
  target: string | Date,
  planner: Planner,
): Promise<AdvanceResult> {
  const targetIso = toIso(target);
  assertNotBefore(targetIso, state.now, "target");

  let current = cloneState(state);
  const transitions: EngineTransition[] = [];

  for (let index = 0; index < MAX_ADVANCE_TRANSITIONS; index += 1) {
    const nextQueueAt = getPendingQueue(current)[0]?.notBefore ?? null;
    const nextPacemakerAt = current.pacemaker.nextAt;
    const nextEventAt = earliestIso(nextQueueAt, nextPacemakerAt);

    if (nextEventAt === null || toMillis(nextEventAt) > toMillis(targetIso)) {
      current.now = targetIso;
      return { state: current, transitions };
    }

    if (
      nextQueueAt !== null &&
      toMillis(nextQueueAt) <= toMillis(nextPacemakerAt)
    ) {
      const transition = await processDueQueue(current, planner, nextQueueAt);
      transitions.push(transition);
      current = transition.state;
      continue;
    }

    const transition = await firePacemaker(
      current,
      planner,
      nextPacemakerAt,
    );
    transitions.push(transition);
    current = transition.state;
  }

  throw new Error(
    `advanceTime exceeded ${MAX_ADVANCE_TRANSITIONS} transitions; the planner may be scheduling an immediate loop`,
  );
}

/**
 * Returns the next wall-clock instant at which the runtime should wake. Queue
 * actions take precedence when they share a timestamp with the pacemaker.
 */
export function getNextScheduledEventAt(state: ConversationState): string {
  const nextQueueAt = getPendingQueue(state)[0]?.notBefore ?? null;
  return earliestIso(nextQueueAt, state.pacemaker.nextAt) ?? state.pacemaker.nextAt;
}

/**
 * Synchronizes a conversation with wall-clock time without replaying every
 * pacemaker interval missed while a process or browser was suspended. All due
 * queue actions are reconsidered together at the current time; otherwise one
 * overdue pacemaker event is processed. The returned state always advances to
 * the supplied wall-clock instant.
 */
export async function synchronizeWallClock(
  state: ConversationState,
  target: string | Date,
  planner: Planner,
): Promise<AdvanceResult> {
  const targetIso = toIso(target);
  assertNotBefore(targetIso, state.now, "target");
  const current = cloneStateAt(state, targetIso);

  if (getDueQueue(current).length > 0) {
    const transition = await processDueQueue(current, planner, targetIso);
    return { state: transition.state, transitions: [transition] };
  }

  if (toMillis(current.pacemaker.nextAt) <= toMillis(targetIso)) {
    const transition = await firePacemaker(current, planner, targetIso);
    return { state: transition.state, transitions: [transition] };
  }

  return { state: current, transitions: [] };
}

async function deliberate(
  state: ConversationState,
  kind: TriggerKind,
  planner: Planner,
): Promise<EngineTransition> {
  const working = cloneState(state);
  // Every trigger observes pending input, including retries driven by time.
  const userMessageIds = working.messages
    .filter((message) => message.role === "user" && message.triggerId === null)
    .map((message) => message.id);
  const dueQueue = getDueQueue(working);
  const trigger: DeliberationTrigger = {
    id: allocateId(working, "trigger"),
    kind,
    at: working.now,
    userMessageIds,
    dueActionIds: dueQueue.map((action) => action.id),
  };

  pushLog(
    working,
    "trigger",
    triggerTitle(kind),
    triggerDetail(trigger),
    trigger.id,
  );

  const pendingQueue = getPendingQueue(working);
  const context: PlannerContext = {
    now: working.now,
    revision: working.revision,
    trigger,
    newUserMessages: working.messages.filter((message) =>
      userMessageIds.includes(message.id),
    ),
    recentMessages: working.messages.slice(-MAX_RECENT_MESSAGES),
    pendingQueue,
    dueQueue,
    pacemaker: { ...working.pacemaker },
    contactPolicy: { ...working.contactPolicy },
    visibleMessageRequired: isVisibleMessageRequired(working),
  };

  try {
    const rawPlan = await planner(context);
    const plan = PlannerOutputSchema.parse(rawPlan);
    const applied = applyPlanAtomically(working, trigger, plan);
    for (const message of applied.messages) {
      if (userMessageIds.includes(message.id)) message.triggerId = trigger.id;
    }
    applied.revision += 1;
    return {
      state: applied,
      trigger,
      plan,
      outcome: "planned",
      error: null,
    };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    recoverFromPlannerError(working, trigger, dueQueue, message);
    working.revision += 1;
    return {
      state: working,
      trigger,
      plan: null,
      outcome: "planner_error",
      error: message,
    };
  }
}

function applyPlanAtomically(
  state: ConversationState,
  trigger: DeliberationTrigger,
  plan: PlannerOutput,
): ConversationState {
  const next = cloneState(state);
  const pending = new Map(
    getPendingQueue(next).map((action) => [action.id, action]),
  );
  const dueIds = new Set(trigger.dueActionIds);
  const acceptedIds = new Set(plan.accepted_due_action_ids);
  const mutationTargets = new Set<string>();

  if (acceptedIds.size !== plan.accepted_due_action_ids.length) {
    throw new Error("accepted_due_action_ids contains duplicates");
  }

  for (const id of acceptedIds) {
    if (!dueIds.has(id)) {
      throw new Error(`accepted action ${id} is not currently due`);
    }
  }

  for (const mutation of plan.queue_mutations) {
    if (mutationTargets.has(mutation.target_id)) {
      throw new Error(`queue action ${mutation.target_id} is mutated twice`);
    }
    if (acceptedIds.has(mutation.target_id)) {
      throw new Error(
        `queue action ${mutation.target_id} cannot be accepted and mutated in the same plan`,
      );
    }
    if (!pending.has(mutation.target_id)) {
      throw new Error(
        `queue mutation targets non-pending action ${mutation.target_id}`,
      );
    }
    mutationTargets.add(mutation.target_id);
  }

  for (const id of dueIds) {
    if (!acceptedIds.has(id) && !mutationTargets.has(id)) {
      throw new Error(
        `due action ${id} must be explicitly accepted, cancelled, or rescheduled`,
      );
    }
  }

  const visibleActions =
    plan.immediate_messages.length +
    plan.accepted_due_action_ids.filter(
      (id) => pending.get(id)?.type === "send_message",
    ).length;
  if (isVisibleMessageRequired(next) && visibleActions === 0) {
    throw new Error(
      "bounded-silence deadline requires at least one visible message",
    );
  }
  if (
    trigger.userMessageIds.length === 0 &&
    !next.contactPolicy.contactAllowed &&
    visibleActions > 0
  ) {
    throw new Error(
      "external policy currently blocks proactive visible messages",
    );
  }

  // Acceptance is a set: delivery order belongs to the runtime, not the model.
  // The pending map is already ordered by eligibility time and stable ID.
  for (const action of pending.values()) {
    if (!acceptedIds.has(action.id)) continue;
    if (action.type === "send_message") {
      emitAssistantMessage(
        next,
        action.content ?? "",
        action.reason,
        trigger.id,
      );
      action.status = "delivered";
      action.resolutionReason = "accepted_at_due_time";
      pushLog(
        next,
        "delivery",
        "Scheduled message delivered",
        action.reason,
        trigger.id,
      );
    } else {
      action.status = "consumed";
      action.resolutionReason = "reconsideration_completed";
      pushLog(
        next,
        "queue",
        "Reconsideration consumed",
        action.reason,
        trigger.id,
      );
    }
    action.resolvedAt = next.now;
  }

  for (const mutation of plan.queue_mutations) {
    const action = pending.get(mutation.target_id);
    if (!action) throw new Error(`queue action ${mutation.target_id} vanished`);

    if (mutation.operation === "cancel") {
      action.status = "cancelled";
      action.resolvedAt = next.now;
      action.resolutionReason = mutation.reason;
      pushLog(next, "queue", "Queued action cancelled", mutation.reason, trigger.id);
      continue;
    }

    if (mutation.operation === "reschedule") {
      if (mutation.delay_seconds === null) {
        throw new Error("reschedule mutation is missing delay_seconds");
      }
      action.notBefore = addSeconds(next.now, mutation.delay_seconds);
      action.reason = mutation.reason;
      pushLog(
        next,
        "queue",
        "Queued action rescheduled",
        `${action.id} → ${action.notBefore}`,
        trigger.id,
      );
      continue;
    }

    if (action.type !== "send_message") {
      throw new Error("only send_message actions can have prepared content replaced");
    }
    if (mutation.content === null) {
      throw new Error("replace mutation is missing content");
    }
    action.content = mutation.content;
    action.reason = mutation.reason;
    if (mutation.delay_seconds !== null) {
      action.notBefore = addSeconds(next.now, mutation.delay_seconds);
    }
    pushLog(next, "queue", "Queued message replaced", mutation.reason, trigger.id);
  }

  for (const message of plan.immediate_messages) {
    emitAssistantMessage(next, message.content, message.reason, trigger.id);
  }

  for (const draft of plan.scheduled_actions) {
    const action: QueueAction = {
      id: allocateId(next, draft.type === "send_message" ? "send" : "wake"),
      type: draft.type,
      content: draft.content,
      notBefore: addSeconds(next.now, draft.delay_seconds),
      reason: draft.reason,
      createdAt: next.now,
      createdByTriggerId: trigger.id,
      status: "pending",
      resolvedAt: null,
      resolutionReason: null,
    };
    next.queue.push(action);
    pushLog(
      next,
      "queue",
      action.type === "send_message"
        ? "Message scheduled"
        : "Reconsideration scheduled",
      `${action.reason} · ${action.notBefore}`,
      trigger.id,
    );
  }

  const pacemakerSeconds =
    plan.next_pacemaker_seconds ?? next.pacemaker.intervalSeconds;
  if (
    trigger.kind === "pacemaker" ||
    toMillis(next.pacemaker.nextAt) <= toMillis(next.now) ||
    plan.next_pacemaker_seconds !== null
  ) {
    next.pacemaker.nextAt = addSeconds(next.now, pacemakerSeconds);
  }
  alignPacemakerWithContactDeadline(next);

  pushLog(
    next,
    visibleActions === 0 ? "silence" : "plan",
    visibleActions === 0 ? "AI chose silence" : "Plan applied",
    plan.internal_summary,
    trigger.id,
  );

  return next;
}

function recoverFromPlannerError(
  state: ConversationState,
  trigger: DeliberationTrigger,
  dueQueue: QueueAction[],
  message: string,
): void {
  for (const dueAction of dueQueue) {
    const action = state.queue.find((item) => item.id === dueAction.id);
    if (!action || action.status !== "pending") continue;
    action.notBefore = addSeconds(state.now, FAILURE_RETRY_SECONDS);
  }
  state.pacemaker.nextAt = addSeconds(
    state.now,
    Math.min(state.pacemaker.intervalSeconds, FAILURE_RETRY_SECONDS),
  );
  pushLog(
    state,
    "error",
    "Planner failed safely",
    `${message}. Pending actions were not delivered and due actions will be reconsidered.`,
    trigger.id,
  );
}

function emitAssistantMessage(
  state: ConversationState,
  content: string,
  reason: string,
  triggerId: string,
): void {
  if (!content.trim()) throw new Error("assistant messages cannot be empty");
  state.messages.push({
    id: allocateId(state, "msg"),
    role: "assistant",
    content: content.trim(),
    at: state.now,
    reason,
    triggerId,
  });
  const policy = state.contactPolicy;
  policy.lastVisibleAssistantAt = state.now;
  if (policy.enabled && policy.maxSilenceSeconds !== null) {
    policy.deadlineAt = addSeconds(state.now, policy.maxSilenceSeconds);
  }
}

function pushLog(
  state: ConversationState,
  kind: EngineLogKind,
  title: string,
  detail: string,
  triggerId: string | null,
): void {
  state.log.push({
    id: allocateId(state, "log"),
    kind,
    at: state.now,
    title,
    detail,
    triggerId,
  });
}

function triggerTitle(kind: TriggerKind): string {
  if (kind === "user_message") return "User message trigger";
  if (kind === "pacemaker") return "Dialogue pacemaker";
  return "Queue due trigger";
}

function triggerDetail(trigger: DeliberationTrigger): string {
  if (trigger.kind === "user_message") {
    return `${trigger.userMessageIds.length} new message(s); ${trigger.dueActionIds.length} due action(s)`;
  }
  return `${trigger.dueActionIds.length} due action(s)`;
}

function hasUnprocessedUserMessages(state: ConversationState): boolean {
  return state.messages.some(
    (message) => message.role === "user" && message.triggerId === null,
  );
}

function cloneState(state: ConversationState): ConversationState {
  return {
    ...state,
    messages: state.messages.map((message) => ({ ...message })),
    queue: state.queue.map((action) => ({ ...action })),
    log: state.log.map((entry) => ({ ...entry })),
    pacemaker: { ...state.pacemaker },
    contactPolicy: { ...state.contactPolicy },
  };
}

function alignPacemakerWithContactDeadline(state: ConversationState): void {
  if (toMillis(state.pacemaker.nextAt) < toMillis(state.now)) {
    state.pacemaker.nextAt = state.now;
  }
  const policy = state.contactPolicy;
  if (!policy.enabled || !policy.contactAllowed || policy.deadlineAt === null) {
    return;
  }
  const wakeAt =
    toMillis(policy.deadlineAt) <= toMillis(state.now)
      ? state.now
      : policy.deadlineAt;
  if (toMillis(wakeAt) < toMillis(state.pacemaker.nextAt)) {
    state.pacemaker.nextAt = wakeAt;
  }
}

function cloneStateAt(
  state: ConversationState,
  at: string | Date,
): ConversationState {
  const next = cloneState(state);
  const nextNow = toIso(at);
  assertNotBefore(nextNow, state.now, "event time");
  next.now = nextNow;
  return next;
}

function allocateId(state: ConversationState, prefix: string): string {
  state.sequence += 1;
  return `${prefix}-${state.sequence.toString(36).padStart(4, "0")}`;
}

function compareQueueActions(left: QueueAction, right: QueueAction): number {
  const timeDifference = toMillis(left.notBefore) - toMillis(right.notBefore);
  return timeDifference === 0 ? left.id.localeCompare(right.id) : timeDifference;
}

function earliestIso(left: string | null, right: string | null): string | null {
  if (left === null) return right;
  if (right === null) return left;
  return toMillis(left) <= toMillis(right) ? left : right;
}

export function addSeconds(value: string | Date, seconds: number): string {
  if (!Number.isFinite(seconds)) throw new Error("seconds must be finite");
  return new Date(toMillis(value) + seconds * 1_000).toISOString();
}

function toIso(value: string | Date): string {
  const milliseconds = toMillis(value);
  return new Date(milliseconds).toISOString();
}

function toMillis(value: string | Date): number {
  const milliseconds =
    value instanceof Date ? value.getTime() : Date.parse(value);
  if (!Number.isFinite(milliseconds)) {
    throw new Error(`invalid date: ${String(value)}`);
  }
  return milliseconds;
}

function assertNotBefore(value: string, minimum: string, label: string): void {
  if (toMillis(value) < toMillis(minimum)) {
    throw new Error(`${label} cannot move backwards in time`);
  }
}

function assertPositiveInteger(value: number, label: string): void {
  if (!Number.isInteger(value) || value <= 0) {
    throw new Error(`${label} must be a positive integer`);
  }
}
