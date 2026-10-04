# Core concepts

[English](core-concepts.md) | [中文](../zh/core-concepts.md)

## Conversation as a timeline

Proactive AI does not treat a conversation as a sequence of mandatory question-answer turns. It treats conversation as a timeline containing:

- zero, one, or multiple incoming user messages;
- periods of user and AI silence;
- internal AI wakeups;
- immediate and scheduled outgoing messages;
- changes to memory and pending intentions.

A user message is an observation available to the AI. It can trigger thought, but it does not require an immediate or visible response.

## Message arrivals and decision snapshots

Every press of **Send** is recorded as a separate, timestamped arrival. An arrival requests deliberation, but arrivals, model calls, and visible replies do not have to correspond one-to-one. Messages that arrive close together may be collected into the ordered `newUserMessages` list of one decision snapshot.

The same visible pattern—several user bubbles followed by one AI response—can therefore have two causes. The AI may already have considered an earlier message and deliberately deferred its response, or the user may have sent the next message before the earlier inference finished. In the second case, the older candidate plan is stale: the coordinator discards it before commit and replans from a snapshot containing all still-unprocessed input. Input is marked processed only when a valid plan commits, including a deliberate silence plan; failed or discarded plans leave the input available for a later decision.

## Unified decision loop

The same decision loop runs when a new user message arrives, the pacemaker fires, or a scheduled queue item becomes eligible:

```text
trigger
  -> read the latest timeline, memory, current time, and pending queue
  -> decide whether the existing plan is still appropriate
  -> keep, cancel, edit, postpone, or add queue items
  -> send any messages that are appropriate now
  -> optionally schedule a future reconsideration
```

This makes a new user message an interruption that may replan older, unsent replies rather than merely appending another independent turn.

## Mutable time queue

A future action uses `not_before` as its earliest eligible time, not as a guarantee that it will be sent at an exact second. When the time arrives, the system rechecks the current context before delivery.

```json
{
  "queue": [
    {
      "id": "message-123",
      "type": "send_message",
      "content": "I thought of one more thing that might matter.",
      "not_before": "2026-07-31T15:02:00+08:00",
      "reason": "continue_current_thought"
    },
    {
      "id": "wake-456",
      "type": "reconsider",
      "not_before": "2026-07-31T20:00:00+08:00",
      "reason": "consider_following_up_on_the_user_plan"
    }
  ]
}
```

Short conversational bursts may use prepared `send_message` items separated by seconds. Longer delays should usually use `reconsider`, allowing the AI to generate fresh content from the latest context rather than sending stale text.

## Dialogue pacemaker

The pacemaker guarantees another opportunity to think; it does not guarantee that the AI will speak on every cycle.

On each wakeup, the AI may:

- stay silent;
- send one or more messages now;
- add, change, or cancel scheduled messages;
- schedule a future reconsideration;
- proactively begin a new topic grounded in conversation or memory.

## Bounded silence

The implemented bounded-silence policy can place a configurable deadline on continuous silence. Before that deadline, the planner may still remain silent. After it, the deterministic runtime accepts only a plan that produces at least one visible message, provided the external policy gate permits contact.

This policy is distinct from the pacemaker: the pacemaker creates another decision opportunity, while the deadline prevents every opportunity from ending in silence forever. A temporary contact restriction preserves the deadline; a visible AI message moves it forward; disabling the policy clears it.

## Behavioral principles

- **Silence is valid.** Seeing a message does not create a duty to answer.
- **Pending speech is revisable.** Unsent messages must adapt to new context.
- **Time is context.** Delay and silence can change what an appropriate reply is.
- **Initiative needs a reason.** Proactive messages should be grounded in the conversation, memory, or a meaningful change—not generated merely to create activity.
- **Users remain in control.** Proactive behavior should be inspectable, adjustable, and reversible.
