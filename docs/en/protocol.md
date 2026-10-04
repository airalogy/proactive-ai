# Temporal conversation protocol

[English](protocol.md) | [中文](../zh/protocol.md)

This document specifies the executable protocol implemented by `@proactive-ai/core`. It separates language-model judgment from deterministic time, queue, and delivery semantics.

## State and events

At time `t`, the conversation state is:

```text
S(t) = <H(t), Q(t), C(t), P(t), L(t)>
```

- `H(t)`: timestamped user and assistant message history;
- `Q(t)`: persistent queue of future actions;
- `C(t)`: logical clock, revision, and sequence counters;
- `P(t)`: pacemaker interval and next wakeup time.
- `L(t)`: bounded-silence configuration, last visible assistant message, next contact deadline, and the current external-policy verdict.

The engine recognizes three trigger kinds:

```text
E = user_message | pacemaker | queue_due
```

Message arrival is distinct from planner execution. Every user send is first recorded as an independent timestamped message and requests deliberation. When the coordinator takes a decision snapshot, one `user_message` trigger may reference one or many ordered messages not yet handled by a committed plan. Reading a message alone does not mark it processed; a valid silent plan does. Every trigger also includes all unprocessed input, including input retained after a failure. A pacemaker event may therefore contain zero or more such messages. A `queue_due` event additionally contains every pending action whose `not_before` time has arrived.

## Planner output

For every trigger, the planner maps the current state and event to a temporal plan:

```text
π(S(t), e(t)) -> <U, N, Δ, A, p, r>
```

- `U`: zero to eight messages to send immediately;
- `N`: zero to sixteen new future actions;
- `Δ`: mutations to existing pending actions;
- `A`: identifiers of due actions explicitly accepted after rechecking;
- `p`: optional delay until the next pacemaker;
- `r`: a short auditable decision summary.

The portable JSON form is:

```json
{
  "schema_version": "1",
  "immediate_messages": [
    {
      "content": "It sounds like this interview matters to you.",
      "reason": "acknowledge_emotional_context"
    },
    {
      "content": "Which part worries you most?",
      "reason": "invite_low_effort_next_step"
    }
  ],
  "scheduled_actions": [
    {
      "type": "send_message",
      "delay_seconds": 20,
      "content": "One more practical thought...",
      "reason": "short_burst_continuation"
    },
    {
      "type": "reconsider",
      "delay_seconds": 7200,
      "content": null,
      "reason": "follow_up_interview"
    }
  ],
  "queue_mutations": [],
  "accepted_due_action_ids": [],
  "next_pacemaker_seconds": 1800,
  "internal_summary": "Acknowledge now, continue the burst shortly, and reconsider a longer follow-up later."
}
```

Models return relative `delay_seconds`; the deterministic scheduler converts it to an absolute `not_before` timestamp. This prevents the model from becoming the source of truth for clocks or date arithmetic.

## Queue actions

Two future action types have deliberately different semantics.

### `send_message`

Stores prepared text for a short conversational continuation. Reaching `not_before` does not automatically deliver it. The planner must see the latest context and include the action id in `accepted_due_action_ids`; otherwise it must cancel, reschedule, or replace the action.

### `reconsider`

Reserves a future opportunity to think without committing to future wording. When due, it is consumed after replanning. The planner may then remain silent, send fresh immediate messages, or create another future action.

Queue actions progress through these states:

```text
pending -> delivered   (accepted send_message)
pending -> consumed    (accepted reconsider)
pending -> cancelled   (cancel mutation)
pending -> pending     (reschedule or replace mutation)
```

## Mutations

Existing pending actions may be changed atomically:

- `cancel`: invalidate an action;
- `reschedule`: assign a new relative delay and reason;
- `replace`: update prepared message content, optionally with a new delay.

Every mutation names a stable `target_id`. A planner cannot mutate an action twice in one plan, accept and mutate the same action, or target an action that is not pending.

## Atomic delivery invariant

The most important safety invariant is:

> Every due action must be resolved exactly once by the same plan that observes it, and no due message can be delivered without explicit acceptance.

The engine validates the entire planner output before applying any visible action. If JSON parsing, schema validation, provider transport, or queue consistency fails, it fails closed: immediate output is discarded, due messages remain pending, due times are moved forward by a short retry interval, and the pacemaker is scheduled to retry. No stale message leaks from a partially applied plan.

User-message processing markers are committed only with a valid plan. Failed input remains available to a later user event, queue event, or pacemaker wakeup. The input coordinator returns the recovery state after a failure instead of immediately looping; its caller drives the scheduled retry using the selected clock. Recovery may update retry times, but never applies candidate messages or candidate queue changes.

## Ordering and snapshot freshness

When a queue action and pacemaker share the same timestamp, queue due processing runs first. Accepted due actions are executed in `not_before` order, with stable identifiers breaking ties; the order of IDs returned by the planner does not change delivery order. Accepted prepared messages precede newly generated immediate messages, which retain their list order. Advancing the virtual clock repeatedly processes the earliest event until the target time is reached.

Every candidate plan is bound to the state revision from which its context was built. If another user message arrives while the planner is running, the current revision advances. The coordinator then discards the older candidate before any message or queue mutation is committed and immediately replans with all still-unprocessed input. This makes rapid input coalescing an execution property, not a claim that several user sends were one arrival event.

## Silence

Silence is represented by empty `immediate_messages` and no accepted due send. It is an ordinary successful plan, not an error or missing response. A pacemaker therefore guarantees another deliberation opportunity, not another notification.

When bounded silence is enabled, `deadline_at` places an upper bound on this otherwise valid silence. Before the deadline, another silent plan remains valid. At or after the deadline, if `contact_allowed` is true, the next valid plan must produce at least one visible message. The runtime validates this requirement before committing any part of the plan. A silence-only plan fails closed, keeps the deadline intact, and schedules a retry.

A visible assistant message records `last_visible_assistant_at` and moves the deadline forward by `max_silence_seconds`. Temporarily setting `contact_allowed` to false suspends enforcement without clearing the deadline; disabling bounded silence explicitly clears it. The pacemaker is always moved early enough to revisit an allowed deadline. While the gate is false, autonomous triggers cannot emit visible messages; a due prepared send must be postponed or cancelled. Direct responses to a new user event remain possible.

## Limits of version 1

Version 1 is intentionally narrow. It accepts a deterministic external-policy verdict but does not itself calculate notification permission, quiet hours, rate limits, or domain-specific safeguards. It also does not yet define multi-user channels, tool execution, memory retrieval, or distributed exactly-once delivery. These belong above or below the temporal conversation protocol and can be added without changing its central abstraction.
