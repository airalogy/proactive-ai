import assert from "node:assert/strict";
import test from "node:test";

import {
  addSeconds,
  advanceTime,
  appendUserMessages,
  configureBoundedSilence,
  ConversationCoordinator,
  createConversationState,
  firePacemaker,
  getNextScheduledEventAt,
  getPendingQueue,
  isVisibleMessageRequired,
  processDueQueue,
  receiveUserMessages,
  setProactiveContactAllowed,
  synchronizeWallClock,
  type Planner,
} from "../src/index";
import { demoPlanner } from "../src/demo-planner";

const START = "2026-07-31T01:00:00.000Z";

const silentPlanner: Planner = () => ({
  schema_version: "1",
  immediate_messages: [],
  scheduled_actions: [],
  queue_mutations: [],
  accepted_due_action_ids: [],
  next_pacemaker_seconds: null,
  internal_summary: "No visible message is justified.",
});

test("one user event can emit multiple messages and schedule multiple futures", async () => {
  const initial = createConversationState({ now: START });
  const transition = await receiveUserMessages(
    initial,
    ["我明天有个很重要的面试，有点紧张"],
    demoPlanner,
  );

  assert.equal(transition.outcome, "planned");
  assert.equal(transition.state.messages.length, 3);
  assert.deepEqual(
    transition.state.messages.map((message) => message.role),
    ["user", "assistant", "assistant"],
  );
  assert.deepEqual(
    getPendingQueue(transition.state).map((action) => action.type),
    ["send_message", "reconsider"],
  );
});

test("new user input cancels a stale future message before delivery", async () => {
  const first = await receiveUserMessages(
    createConversationState({ now: START }),
    ["我明天有面试"],
    demoPlanner,
  );
  const changed = await receiveUserMessages(
    first.state,
    ["取消了，不去了"],
    demoPlanner,
    addSeconds(START, 10),
  );
  const advanced = await advanceTime(
    changed.state,
    addSeconds(START, 30),
    demoPlanner,
  );

  assert.equal(getPendingQueue(advanced.state).length, 0);
  assert.equal(
    advanced.state.messages.some((message) =>
      message.content.includes("开场的一分钟"),
    ),
    false,
  );
  assert.equal(
    advanced.state.queue.filter((action) => action.status === "cancelled")
      .length,
    2,
  );
});

test("a due send is rechecked and explicitly accepted before delivery", async () => {
  const first = await receiveUserMessages(
    createConversationState({ now: START }),
    ["我明天有面试"],
    demoPlanner,
  );
  const result = await advanceTime(
    first.state,
    addSeconds(START, 21),
    demoPlanner,
  );

  assert.equal(result.transitions.length, 1);
  assert.equal(result.transitions[0]?.trigger.kind, "queue_due");
  assert.equal(
    result.state.messages.at(-1)?.content.includes("开场的一分钟"),
    true,
  );
  assert.equal(result.state.queue[0]?.status, "delivered");
});

test("the next wall-clock wake prefers an earlier queued action", async () => {
  const first = await receiveUserMessages(
    createConversationState({ now: START }),
    ["I have an interview tomorrow"],
    demoPlanner,
  );

  assert.equal(
    getNextScheduledEventAt(first.state),
    addSeconds(START, 20),
  );
});

test("accepted sends use runtime time and ID order, not model acceptance order", async () => {
  const scheduled = await receiveUserMessages(
    createConversationState({ now: START }),
    ["Please send these later"],
    (context) => ({
      ...silentPlanner(context),
      scheduled_actions: [
        { type: "send_message", delay_seconds: 30, content: "Later", reason: "test" },
        { type: "send_message", delay_seconds: 20, content: "First", reason: "test" },
        { type: "send_message", delay_seconds: 20, content: "Second", reason: "test" },
      ],
    }),
  );
  // Neither storage order nor the model's acceptance order controls delivery.
  scheduled.state.queue.reverse();
  const result = await synchronizeWallClock(
    scheduled.state,
    addSeconds(START, 40),
    (context) => ({
      ...silentPlanner(context),
      accepted_due_action_ids: context.dueQueue.map((action) => action.id).reverse(),
    }),
  );
  assert.equal(result.transitions[0]?.outcome, "planned");
  assert.deepEqual(
    result.state.messages.filter((m) => m.role === "assistant").map((m) => m.content),
    ["First", "Second", "Later"],
  );
  const replay = await synchronizeWallClock(result.state, addSeconds(START, 41), silentPlanner);
  assert.equal(replay.transitions.length, 0);
  assert.equal(replay.state.messages.length, result.state.messages.length);
});

test("wall-clock synchronization collapses missed pacemaker intervals", async () => {
  const state = createConversationState({
    now: START,
    pacemakerIntervalSeconds: 1_800,
  });
  const target = addSeconds(START, 7_200);
  const result = await synchronizeWallClock(state, target, silentPlanner);

  assert.equal(result.transitions.length, 1);
  assert.equal(result.transitions[0]?.trigger.kind, "pacemaker");
  assert.equal(result.transitions[0]?.trigger.at, target);
  assert.equal(result.state.now, target);
  assert.equal(result.state.pacemaker.nextAt, addSeconds(target, 1_800));
});

test("wall-clock synchronization rechecks all overdue queue actions once", async () => {
  const first = await receiveUserMessages(
    createConversationState({ now: START }),
    ["I have an interview tomorrow"],
    demoPlanner,
  );
  const target = addSeconds(START, 10_800);
  const result = await synchronizeWallClock(first.state, target, demoPlanner);

  assert.equal(result.transitions.length, 1);
  assert.equal(result.transitions[0]?.trigger.kind, "queue_due");
  assert.equal(result.transitions[0]?.trigger.dueActionIds.length, 2);
  assert.equal(result.state.now, target);
  assert.equal(getPendingQueue(result.state).length, 0);
});

test("a pacemaker may deliberate and remain silent", async () => {
  const transition = await firePacemaker(
    createConversationState({ now: START }),
    demoPlanner,
    addSeconds(START, 1_800),
  );

  assert.equal(transition.outcome, "planned");
  assert.equal(transition.state.messages.length, 0);
  assert.equal(transition.state.log.at(-1)?.kind, "silence");
});

test("bounded silence permits silence before its contact deadline", async () => {
  const state = createConversationState({
    now: START,
    boundedSilenceSeconds: 3_600,
  });
  const transition = await firePacemaker(
    state,
    silentPlanner,
    addSeconds(START, 1_800),
  );

  assert.equal(transition.outcome, "planned");
  assert.equal(transition.state.messages.length, 0);
  assert.equal(
    transition.state.contactPolicy.deadlineAt,
    addSeconds(START, 3_600),
  );
  assert.equal(isVisibleMessageRequired(transition.state), false);
});

test("a silence-only plan fails closed after the contact deadline", async () => {
  const state = createConversationState({
    now: START,
    boundedSilenceSeconds: 1_800,
  });
  const deadline = state.contactPolicy.deadlineAt;
  assert.ok(deadline);

  const transition = await firePacemaker(state, silentPlanner, deadline);

  assert.equal(transition.outcome, "planner_error");
  assert.match(transition.error ?? "", /requires at least one visible message/u);
  assert.equal(transition.state.messages.length, 0);
  assert.equal(transition.state.contactPolicy.deadlineAt, deadline);
  assert.equal(isVisibleMessageRequired(transition.state), true);
  assert.equal(transition.state.pacemaker.nextAt, addSeconds(deadline, 60));
});

test("the deterministic planner renews contact when bounded silence expires", async () => {
  const state = createConversationState({
    now: START,
    boundedSilenceSeconds: 1_800,
  });
  const deadline = state.contactPolicy.deadlineAt;
  assert.ok(deadline);

  const transition = await firePacemaker(state, demoPlanner, deadline);

  assert.equal(transition.outcome, "planned");
  assert.equal(transition.state.messages.length, 1);
  assert.equal(
    transition.state.messages[0]?.reason,
    "bounded_silence_contact_deadline",
  );
  assert.equal(
    transition.state.contactPolicy.lastVisibleAssistantAt,
    deadline,
  );
  assert.equal(
    transition.state.contactPolicy.deadlineAt,
    addSeconds(deadline, 1_800),
  );
});

test("an external policy pause preserves rather than clears the deadline", async () => {
  const state = createConversationState({
    now: START,
    boundedSilenceSeconds: 1_800,
    proactiveContactAllowed: false,
  });
  const deadline = state.contactPolicy.deadlineAt;
  assert.ok(deadline);

  const paused = await firePacemaker(state, silentPlanner, deadline);
  assert.equal(paused.outcome, "planned");
  assert.equal(paused.state.contactPolicy.deadlineAt, deadline);
  assert.equal(isVisibleMessageRequired(paused.state), false);

  const resumed = setProactiveContactAllowed(paused.state, true);
  assert.equal(resumed.pacemaker.nextAt, resumed.now);
  assert.equal(isVisibleMessageRequired(resumed), true);

  const contacted = await firePacemaker(resumed, demoPlanner, resumed.now);
  assert.equal(contacted.outcome, "planned");
  assert.equal(contacted.state.messages.length, 1);
});

test("the runtime blocks autonomous output while external policy is paused", async () => {
  const state = createConversationState({
    now: START,
    boundedSilenceSeconds: 1_800,
    proactiveContactAllowed: false,
  });
  const speakingPlanner: Planner = () => ({
    schema_version: "1",
    immediate_messages: [
      { content: "This must not be delivered.", reason: "policy_test" },
    ],
    scheduled_actions: [],
    queue_mutations: [],
    accepted_due_action_ids: [],
    next_pacemaker_seconds: null,
    internal_summary: "Attempt an externally blocked contact.",
  });

  const transition = await firePacemaker(state, speakingPlanner, START);

  assert.equal(transition.outcome, "planner_error");
  assert.match(transition.error ?? "", /external policy/u);
  assert.equal(transition.state.messages.length, 0);
});

test("the deterministic planner postpones a due send while contact is paused", async () => {
  const first = await receiveUserMessages(
    createConversationState({
      now: START,
      boundedSilenceSeconds: 14_400,
    }),
    ["我明天有面试"],
    demoPlanner,
  );
  const paused = setProactiveContactAllowed(first.state, false);
  const dueAt = getPendingQueue(paused)[0]?.notBefore;
  assert.ok(dueAt);

  const transition = await processDueQueue(paused, demoPlanner, dueAt);

  assert.equal(transition.outcome, "planned");
  assert.equal(transition.state.messages.length, 3);
  assert.equal(transition.state.queue[0]?.status, "pending");
  assert.equal(
    transition.state.queue[0]?.notBefore,
    addSeconds(dueAt, 1_800),
  );
});

test("visible output resets the deadline and disabling the policy clears it", async () => {
  const initial = createConversationState({
    now: START,
    boundedSilenceSeconds: 1_800,
  });
  const repliedAt = addSeconds(START, 100);
  const replied = await receiveUserMessages(
    initial,
    ["hello"],
    demoPlanner,
    repliedAt,
  );

  assert.equal(
    replied.state.contactPolicy.lastVisibleAssistantAt,
    repliedAt,
  );
  assert.equal(
    replied.state.contactPolicy.deadlineAt,
    addSeconds(repliedAt, 1_800),
  );

  const disabled = configureBoundedSilence(replied.state, null);
  assert.equal(disabled.contactPolicy.enabled, false);
  assert.equal(disabled.contactPolicy.deadlineAt, null);
});

test("multiple user messages are interpreted as a single batch trigger", async () => {
  const transition = await receiveUserMessages(
    createConversationState({ now: START }),
    ["第一条", "我再补充一点", "其实还有第三件事"],
    demoPlanner,
  );

  assert.equal(transition.trigger.userMessageIds.length, 3);
  assert.equal(transition.state.messages.length, 5);
  assert.equal(
    transition.state.messages.some((message) =>
      message.content.includes("3 条消息"),
    ),
    true,
  );
});

test("rapid independent arrivals share one deliberation snapshot", async () => {
  const contexts: number[] = [];
  const planner: Planner = (context) => {
    contexts.push(context.newUserMessages.length);
    return demoPlanner(context);
  };
  const coordinator = new ConversationCoordinator(
    createConversationState({ now: START }),
    planner,
    { coalesceWindowMs: 0 },
  );

  const transitions = await Promise.all([
    coordinator.receiveUserMessage("第一条", START),
    coordinator.receiveUserMessage("我再补充一点", START),
    coordinator.receiveUserMessage("其实还有第三件事", START),
  ]);

  assert.deepEqual(contexts, [3]);
  assert.equal(transitions[0], transitions[2]);
  assert.equal(transitions[0]?.trigger.userMessageIds.length, 3);
  assert.equal(
    coordinator
      .getState()
      .messages.some((message) => message.content.includes("3 条消息")),
    true,
  );
});

test("a message arriving during inference invalidates the older candidate", async () => {
  let plannerCalls = 0;
  let markFirstStarted: (() => void) | undefined;
  let releaseFirst: (() => void) | undefined;
  const firstStarted = new Promise<void>((resolve) => {
    markFirstStarted = resolve;
  });
  const firstMayFinish = new Promise<void>((resolve) => {
    releaseFirst = resolve;
  });
  const planner: Planner = async (context) => {
    plannerCalls += 1;
    if (plannerCalls === 1) {
      markFirstStarted?.();
      await firstMayFinish;
    }
    return {
      schema_version: "1",
      immediate_messages: [
        {
          content: `Observed ${context.newUserMessages.length} message(s).`,
          reason: "test_snapshot_freshness",
        },
      ],
      scheduled_actions: [],
      queue_mutations: [],
      accepted_due_action_ids: [],
      next_pacemaker_seconds: null,
      internal_summary: "Respond only from the latest decision snapshot.",
    };
  };
  const coordinator = new ConversationCoordinator(
    createConversationState({ now: START }),
    planner,
    { coalesceWindowMs: 0 },
  );

  const first = coordinator.receiveUserMessage("first", START);
  await firstStarted;
  const second = coordinator.receiveUserMessage(
    "second",
    addSeconds(START, 1),
  );
  releaseFirst?.();
  await Promise.all([first, second]);

  const state = coordinator.getState();
  assert.equal(plannerCalls, 2);
  assert.deepEqual(
    state.messages.map((message) => message.role),
    ["user", "user", "assistant"],
  );
  assert.equal(state.messages.at(-1)?.content, "Observed 2 message(s).");
  assert.equal(
    state.log.some((entry) => entry.title === "Stale plan discarded"),
    true,
  );
});

test("invalid due plan fails closed and never leaks a queued message", async () => {
  const first = await receiveUserMessages(
    createConversationState({ now: START }),
    ["我明天有面试"],
    demoPlanner,
  );
  const dueAt = first.state.queue[0]?.notBefore;
  assert.ok(dueAt);

  const invalidPlanner: Planner = () => ({
    schema_version: "1",
    immediate_messages: [],
    scheduled_actions: [],
    queue_mutations: [],
    accepted_due_action_ids: [],
    next_pacemaker_seconds: null,
    internal_summary: "Invalid because the due item is unresolved.",
  });
  const transition = await processDueQueue(
    first.state,
    invalidPlanner,
    dueAt,
  );

  assert.equal(transition.outcome, "planner_error");
  assert.equal(transition.state.messages.length, 3);
  assert.equal(transition.state.queue[0]?.status, "pending");
  assert.equal(
    transition.state.queue[0]?.notBefore,
    addSeconds(dueAt, 60),
  );
});

test("failed input remains unprocessed and is retried at the recovery wakeup", async () => {
  const initial = createConversationState({ now: START });
  const failed = await receiveUserMessages(initial, ["我明天有面试"], () => {
    throw new Error("temporary planner failure");
  });

  assert.equal(failed.outcome, "planner_error");
  assert.equal(failed.state.messages[0]?.triggerId, null);
  assert.equal(failed.state.pacemaker.nextAt, addSeconds(START, 60));
  assert.deepEqual(initial.messages, []);

  const beforeRetry = await synchronizeWallClock(
    failed.state, addSeconds(START, 59), demoPlanner,
  );
  assert.equal(beforeRetry.transitions.length, 0);
  const retried = await synchronizeWallClock(
    beforeRetry.state, addSeconds(START, 60), demoPlanner,
  );
  assert.equal(retried.transitions.length, 1);
  assert.equal(retried.transitions[0]?.trigger.userMessageIds.length, 1);
  assert.equal(retried.transitions[0]?.outcome, "planned");
  assert.equal(retried.state.messages[0]?.triggerId, retried.transitions[0]?.trigger.id);
  assert.equal(getPendingQueue(retried.state).length, 2);
});

test("a failed input coordinator returns without spinning and retains earlier input", async () => {
  let calls = 0;
  const coordinator = new ConversationCoordinator(
    createConversationState({ now: START }),
    () => { calls += 1; throw new Error("unavailable"); },
    { coalesceWindowMs: 0 },
  );
  const failed = await coordinator.receiveUserMessage("first", START);
  assert.equal(failed.outcome, "planner_error");
  await new Promise((resolve) => setTimeout(resolve, 20));
  assert.equal(calls, 1);
  assert.equal(coordinator.getState().messages[0]?.triggerId, null);

  coordinator.setPlanner((context) => {
    calls += 1;
    assert.deepEqual(context.newUserMessages.map((message) => message.content), ["first", "second"]);
    return silentPlanner(context);
  });
  const recovered = await coordinator.receiveUserMessage("second", addSeconds(START, 1));
  assert.equal(recovered.outcome, "planned");
  assert.equal(calls, 2);
  assert.ok(recovered.state.messages.every((message) => message.triggerId === recovered.trigger.id));
});

test("a due-action trigger includes pending input before accepting stale speech", async () => {
  const first = await receiveUserMessages(
    createConversationState({ now: START }), ["我明天有面试"], demoPlanner,
  );
  const updated = appendUserMessages(first.state, ["面试取消了"], addSeconds(START, 10));
  const transition = await processDueQueue(updated, demoPlanner, addSeconds(START, 20));
  assert.equal(transition.outcome, "planned");
  assert.equal(transition.trigger.userMessageIds.length, 1);
  assert.equal(transition.state.queue.filter((action) => action.status === "cancelled").length, 2);
  assert.equal(transition.state.messages.some((message) => message.content.includes("开场的一分钟")), false);
});

test("the contact deadline advances a later pacemaker without new input or queue actions", async () => {
  const state = createConversationState({
    now: START, pacemakerIntervalSeconds: 7_200, boundedSilenceSeconds: 600,
  });
  const earlier = await firePacemaker(state, (context) => ({
    ...silentPlanner(context), next_pacemaker_seconds: 7_200,
  }), addSeconds(START, 100));
  assert.equal(getNextScheduledEventAt(earlier.state), addSeconds(START, 600));

  const result = await synchronizeWallClock(earlier.state, addSeconds(START, 600), demoPlanner);
  assert.equal(result.transitions.length, 1);
  assert.equal(result.transitions[0]?.trigger.kind, "pacemaker");
  assert.equal(result.state.messages.length, 1);
  assert.equal(result.state.contactPolicy.deadlineAt, addSeconds(START, 1_200));
});
