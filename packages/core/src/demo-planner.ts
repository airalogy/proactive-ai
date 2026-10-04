import type {
  Planner,
  PlannerContext,
  QueueAction,
} from "./engine";
import type {
  ImmediateMessage,
  PlannerOutput,
  QueueMutationDraft,
  ScheduledActionDraft,
} from "./protocol";

const PACEMAKER_SECONDS = 1_800;
const PROACTIVE_SILENCE_SECONDS = 14_400;

/**
 * A deterministic planner for reproducible demos and tests. It demonstrates
 * the protocol rather than pretending to be a general conversational model.
 */
export const demoPlanner: Planner = (context) => {
  if (context.newUserMessages.length > 0) {
    return planForUserMessages(context);
  }

  return planForAutonomousTrigger(context);
};

function planForUserMessages(context: PlannerContext): PlannerOutput {
  const text = context.newUserMessages
    .map((message) => message.content)
    .join("\n");
  const chinese = containsChinese(text);
  const queueMutations = cancelPendingQueue(context.pendingQueue, chinese);
  const immediateMessages: ImmediateMessage[] = [];
  const scheduledActions: ScheduledActionDraft[] = [];

  if (isCancellation(text)) {
    immediateMessages.push({
      content: chinese
        ? "明白，情况已经变了。我把刚才尚未发送的跟进都取消了。"
        : "Understood—the situation changed. I cancelled the follow-ups that had not been sent yet.",
      reason: "acknowledge_changed_context",
    });
  } else if (isInterviewTopic(text)) {
    immediateMessages.push(
      {
        content: chinese
          ? "听起来这场面试对你很重要。"
          : "It sounds like this interview matters to you.",
        reason: "acknowledge_emotional_context",
      },
      {
        content: chinese
          ? "紧张很正常。要不要先用一分钟说说你最担心哪一部分？"
          : "Feeling nervous is normal. Want to spend one minute naming the part that worries you most?",
        reason: "invite_low_effort_next_step",
      },
    );
    scheduledActions.push(
      {
        type: "send_message",
        delay_seconds: 20,
        content: chinese
          ? "我又想到一个很实用的办法：先只准备开场的一分钟，不必一次把整场面试想完。"
          : "One more practical thought: prepare only the first minute first—you do not need to solve the whole interview at once.",
        reason: "short_burst_continuation",
      },
      {
        type: "reconsider",
        delay_seconds: 7_200,
        content: null,
        reason: "follow_up_interview",
      },
    );
  } else if (context.newUserMessages.length > 1) {
    immediateMessages.push(
      {
        content: chinese
          ? `我看到了你刚才连续发来的 ${context.newUserMessages.length} 条消息。`
          : `I saw the ${context.newUserMessages.length} messages that arrived before this decision.`,
        reason: "acknowledge_message_batch",
      },
      {
        content: chinese
          ? "我会把它们当成一个完整的上下文来理解，而不是逐条机械回答。"
          : "I will treat them as one evolving context instead of mechanically answering each line.",
        reason: "explain_batch_interpretation",
      },
    );
    scheduledActions.push({
      type: "reconsider",
      delay_seconds: 1_800,
      content: null,
      reason: "revisit_batched_context",
    });
  } else {
    immediateMessages.push({
      content: chinese
        ? "我看到了。现在先回应到这里；如果之后想到真正有用的补充，我可以再联系你。"
        : "I saw that. I will leave it here for now and can return later if there is a genuinely useful follow-up.",
      reason: "acknowledge_without_over_answering",
    });
    scheduledActions.push({
      type: "reconsider",
      delay_seconds: 1_800,
      content: null,
      reason: "reconsider_latest_context",
    });
  }

  return makePlan({
    immediateMessages,
    scheduledActions,
    queueMutations,
    internalSummary:
      context.pendingQueue.length === 0
        ? "The newly observed user messages were interpreted in one decision snapshot."
        : "New user input invalidated the previous future plan before a replacement plan was created.",
    nextPacemakerSeconds: PACEMAKER_SECONDS,
  });
}

function planForAutonomousTrigger(context: PlannerContext): PlannerOutput {
  const acceptedDueActionIds = context.dueQueue
    .filter(
      (action) =>
        context.contactPolicy.contactAllowed || action.type === "reconsider",
    )
    .map((action) => action.id);
  const queueMutations: QueueMutationDraft[] = context.contactPolicy
    .contactAllowed
    ? []
    : context.dueQueue
        .filter((action) => action.type === "send_message")
        .map((action) => ({
          operation: "reschedule" as const,
          target_id: action.id,
          delay_seconds: PACEMAKER_SECONDS,
          content: null,
          reason: "external_policy_temporarily_blocks_contact",
        }));
  const immediateMessages: ImmediateMessage[] = [];
  const latestText = context.recentMessages.at(-1)?.content ?? "";
  const chinese = containsChinese(latestText);

  for (const action of context.dueQueue) {
    if (action.type !== "reconsider") continue;
    if (!context.contactPolicy.contactAllowed) continue;
    const message = followUpFor(action, chinese);
    if (message) immediateMessages.push(message);
  }

  const acceptedSendWillBeVisible = context.dueQueue.some(
    (action) =>
      action.type === "send_message" &&
      acceptedDueActionIds.includes(action.id),
  );
  if (
    context.visibleMessageRequired &&
    immediateMessages.length === 0 &&
    !acceptedSendWillBeVisible
  ) {
    immediateMessages.push({
      content: chinese
        ? "我们已经安静了一段时间。我想基于现在的情况重新联系你：最近有什么值得继续聊的吗？"
        : "It has been quiet for a while, so I am checking in from the current context. Is there anything worth continuing now?",
      reason: "bounded_silence_contact_deadline",
    });
  } else if (
    context.contactPolicy.contactAllowed &&
    context.dueQueue.length === 0 &&
    shouldInitiateConversation(context)
  ) {
    immediateMessages.push({
      content: chinese
        ? "刚才没有新消息，不过我想起我们之前聊到的事。现在还值得继续吗？"
        : "There is no new message, but I remembered what we discussed earlier. Is it still worth continuing?",
      reason: "pacemaker_grounded_reengagement",
    });
  }

  const summary =
    immediateMessages.length > 0
      ? "The autonomous trigger found a grounded reason to speak."
      : context.dueQueue.length > 0
        ? "Due intentions were rechecked; no additional visible message was needed."
        : "The dialogue pacemaker created a new decision opportunity, but speaking was not justified.";

  return makePlan({
    immediateMessages,
    queueMutations,
    acceptedDueActionIds,
    internalSummary: summary,
    nextPacemakerSeconds: PACEMAKER_SECONDS,
  });
}

function followUpFor(
  action: QueueAction,
  chinese: boolean,
): ImmediateMessage | null {
  if (action.reason === "follow_up_interview") {
    return {
      content: chinese
        ? "过了一会儿，我想回来问问：关于面试，你现在最需要的是一起准备，还是先放松一下？"
        : "I wanted to come back to this: for the interview, would preparation help more now, or would it be better to decompress first?",
      reason: "fresh_follow_up_after_reconsideration",
    };
  }

  if (action.reason === "revisit_batched_context") {
    return {
      content: chinese
        ? "我重新看了一遍你之前连续发来的那些信息。目前没有需要追问的新问题。"
        : "I reviewed the messages that arrived before the earlier decision. I do not have a useful new question right now.",
      reason: "reconsidered_batched_context",
    };
  }

  return null;
}

function shouldInitiateConversation(context: PlannerContext): boolean {
  if (context.recentMessages.length === 0 || context.pendingQueue.length > 0) {
    return false;
  }
  const lastMessage = context.recentMessages.at(-1);
  if (!lastMessage) return false;
  return (
    Date.parse(context.now) - Date.parse(lastMessage.at) >=
    PROACTIVE_SILENCE_SECONDS * 1_000
  );
}

function cancelPendingQueue(
  queue: QueueAction[],
  chinese: boolean,
): QueueMutationDraft[] {
  return queue.map((action) => ({
    operation: "cancel",
    target_id: action.id,
    delay_seconds: null,
    content: null,
    reason: chinese
      ? "用户的新消息改变了上下文，旧计划需要作废"
      : "New user input changed the context, so the old plan was invalidated",
  }));
}

function makePlan(options: {
  immediateMessages?: ImmediateMessage[];
  scheduledActions?: ScheduledActionDraft[];
  queueMutations?: QueueMutationDraft[];
  acceptedDueActionIds?: string[];
  nextPacemakerSeconds?: number | null;
  internalSummary: string;
}): PlannerOutput {
  return {
    schema_version: "1",
    immediate_messages: options.immediateMessages ?? [],
    scheduled_actions: options.scheduledActions ?? [],
    queue_mutations: options.queueMutations ?? [],
    accepted_due_action_ids: options.acceptedDueActionIds ?? [],
    next_pacemaker_seconds: options.nextPacemakerSeconds ?? null,
    internal_summary: options.internalSummary,
  };
}

function containsChinese(value: string): boolean {
  return /[\u3400-\u9fff]/u.test(value);
}

function isInterviewTopic(value: string): boolean {
  return /面试|interview/iu.test(value);
}

function isCancellation(value: string): boolean {
  return /取消|不去了|不用了|算了|cancel(?:led)?|called off|not going/iu.test(
    value,
  );
}
