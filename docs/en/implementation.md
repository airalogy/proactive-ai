# How Proactive AI works

[English](implementation.md) | [中文](../zh/implementation.md)

Proactive AI uses an existing language model to propose dialogue plans, while ordinary code manages time, stores the queue, validates plans, and delivers messages. It does not train a new model or require one to keep running between requests. JSON is the interface for expressing plans; proactive interaction comes from the model and event-driven runtime working together.

This guide follows a conversation through the implementation. For precise field constraints, see the [temporal conversation protocol](protocol.md). To connect a model, see the [provider guide](model-providers.md).

## From a message to the next decision

A model request asks not just what to say now, but also what to do later and whether earlier intentions should change. The complete loop is:

```text
User input / queued action becomes due / dialogue pacemaker
                         ↓
Runtime assembles current context and pending intentions
                         ↓
Language model proposes a JSON plan
                         ↓
Runtime validates and applies one complete state update
                         ↓
Show visible messages, retain future actions, await the next event
```

Each user message is recorded separately, but need not cause a separate model request. The demo's input coordinator uses a default 350 ms coalescing window so rapid messages can enter the same decision. If another message arrives during inference, the coordinator discards the candidate based on the old snapshot and replans using all unprocessed input. It does not display the old reply and then retract it.

## What the model sees

The adapter assembles the following context for each call:

- The current time, state revision, and event that triggered the decision.
- Unprocessed user messages and recent dialogue. The new-input list can be empty.
- The pending queue and the subset of due actions requiring explicit handling.
- The next pacemaker wakeup, contact permission and deadline, and whether this decision must produce a visible message.

The system prompt explains the fields and behavioral rules: silence is allowed, user messages need not be answered mechanically one by one, new information can invalidate earlier plans, and every due action needs an explicit disposition. Each request supplies the context again; the implementation does not depend on the provider remembering the queue between calls.

The current adapter uses OpenAI-compatible Chat Completions. Providers supporting strict structured output use `response_format.type = "json_schema"` with `strict: true`. Other compatible endpoints can use `json_object` or prompt-only JSON generation; both receive the full plan schema in the prompt. JSON mode constrains JSON syntax, while strict structured output also constrains fields and types. Neither guarantees correct contextual judgment, so local validation still applies. See the [OpenAI Docs comparison](https://developers.openai.com/api/docs/guides/structured-outputs#structured-outputs-vs-json-mode).

The adapter currently uses neither function calling nor the LiteLLM SDK. LiteLLM can be an optional compatible gateway without changing the model-to-runtime plan interface.

## JSON expresses a plan rather than only a reply

Suppose the user sends "I have an important interview tomorrow" followed by "I'm nervous." The following complete illustrative plan matches the current output structure; it does not prescribe what a real model must always produce:

```json
{
  "schema_version": "1",
  "immediate_messages": [
    {
      "content": "It is normal to feel nervous before an important interview.",
      "reason": "Acknowledge the user's concern."
    },
    {
      "content": "We can start preparing with one small, concrete step.",
      "reason": "Make preparation easier to begin."
    }
  ],
  "scheduled_actions": [
    {
      "type": "send_message",
      "delay_seconds": 600,
      "content": "Choose one experience that shows your skills and try explaining it in two minutes.",
      "reason": "Offer a preparation suggestion later, subject to a delivery-time check."
    },
    {
      "type": "reconsider",
      "delay_seconds": 7200,
      "content": null,
      "reason": "Decide in two hours whether a follow-up is useful in the latest context."
    }
  ],
  "queue_mutations": [],
  "accepted_due_action_ids": [],
  "next_pacemaker_seconds": 1800,
  "internal_summary": "Respond briefly now and retain a preparation suggestion and a later follow-up decision."
}
```

The fields have distinct responsibilities:

| Field | Purpose |
| --- | --- |
| `schema_version` | Identifies the plan protocol version. |
| `immediate_messages` | Messages proposed for display now; the list may be empty or contain several messages. |
| `scheduled_actions` | New future actions, each with its own type, delay, and reason. |
| `queue_mutations` | Cancellation, postponement, or replacement of existing actions, identified by stable IDs. |
| `accepted_due_action_ids` | Explicitly confirms due actions for this transition; it is not an unconditional send command. |
| `next_pacemaker_seconds` | Proposes the next wakeup interval; `null` means no new interval is proposed. |
| `internal_summary` | A brief decision record, not hidden model reasoning or a visible chat message. |

A `send_message` retains prepared text. A `reconsider` must have `content: null` because it reserves a future decision rather than a prewritten reply. The model proposes relative delays; the runtime assigns action IDs and calculates earliest execution times from the current event time.

Two `immediate_messages` belong to one state update, without an artificial typing delay. To space messages several seconds apart, make the later message a `send_message` with a positive delay and recheck it when due.

## How the runtime executes and revises plans

The runtime does not execute JSON items as they arrive. It first applies two layers of validation:

1. **Structural checks:** Zod validates fields, types, lengths, ranges, and the content constraints for each action type.
2. **State checks:** targets must still be pending, accepted actions must be due, actions cannot receive conflicting dispositions, no due action may be omitted, and autonomous visible output must satisfy contact policy.

The engine applies a valid candidate to a state copy and returns the complete updated state. Here, atomic means that the candidate succeeds or fails as a whole; it does not mean a distributed transaction across databases or external delivery services is already implemented. Accepted prepared sends are ordered by eligibility time and stable ID, followed by new immediate messages in list order.

The initial plan above can lead to different continuations:

| Situation | What happens |
| --- | --- |
| Nothing changes and the suggestion becomes due after 10 minutes | The runtime calls the model again. Only after confirmation does it deliver the saved suggestion. |
| The user says "The interview was cancelled" after 5 minutes | The new input and pending queue enter one decision. The model can cancel both the suggestion and the two-hour follow-up; validation changes their status to `cancelled`. |
| An uncancelled `reconsider` becomes due | The model receives current context and can produce fresh speech, schedule another action, or remain silent while explicitly resolving the due opportunity. |

Cancellation updates an action's status rather than erasing its history. Delivery-time validation ensures that a due action receives a fresh decision, but does not guarantee that decision is semantically correct: the model might still approve inappropriate content that passes structural and queue checks.

Timeouts, refusals, truncated responses, and invalid plans produce no candidate messages or candidate queue changes. The engine retains unprocessed input and pending actions, then separately schedules recovery. Recovery may adjust retry times; it does not partially execute the failed candidate.

## Why the system can speak without new input

The model does not set its own background alarm. Once an API request ends, the program handles waiting. The dialogue pacemaker records the next wakeup time; when it arrives, the program assembles context and calls the model even without new user input. A due queue action can also trigger a decision.

A wakeup does not require speech. If the plan has neither immediate messages nor accepted due sends, there is no visible output. To defer a first reply, the model can remain silent now and schedule a future `reconsider` instead.

An optional bounded-silence policy also retains a contact deadline. Before it, silence is allowed. At or after it, when contact is permitted, the next valid plan must produce visible output. A silence-only candidate is rejected without clearing the deadline. The runtime does not fabricate a fixed greeting and pass it off as model output.

Pausing proactive contact blocks visible output when there is no unprocessed user input, while replies to user messages remain possible. Pausing preserves the deadline; explicitly disabling bounded silence clears it. Eventual contact still requires the runtime to keep running, policy to permit contact, and model planning to succeed.

## Code entry points

| File | What to read |
| --- | --- |
| [protocol.ts](../../packages/core/src/protocol.ts) | `PlannerOutputSchema` and `PLANNER_JSON_SCHEMA` define the plan structure. |
| [openai-compatible.ts](../../packages/core/src/openai-compatible.ts) | System prompt, `serializePlannerContext`, request format, response parsing, and format repair. |
| [engine.ts](../../packages/core/src/engine.ts) | `ConversationCoordinator`, `deliberate`, `applyPlanAtomically`, queue state, and contact policy. |
| [plan/route.ts](../../apps/demo/app/api/plan/route.ts) | Server-side credentials and model calls without returning the key to the browser. |
| [timeline-lab.tsx](../../apps/demo/app/components/timeline-lab.tsx) | Chat UI, browser state, clock drivers, and `/api/plan` requests. |
| [demo-planner.ts](../../packages/core/src/demo-planner.ts) | Repeatable scenarios for demos and offline checks, without a model call. |
| [model-validation.ts](../../scripts/lib/model-validation.ts) | Real-model test scenarios, request budget, and replay of a recorded initial plan. |

In the web demo, core state and scheduling run in the browser; the server route handles model requests. Command-line tests call the same adapter and engine directly. Neither path lets the model bypass the runtime to deliver messages. Delivery in the current demo means adding messages to conversation state for display, not sending WeChat messages, email, or system push notifications.

## Running and checking the implementation

Install and start from the repository root:

```bash
pnpm install
pnpm dev
```

Guided demo needs no key: playback drives preset events and proposals through the real engine, with no free-text composer. For a real model, configure `apps/demo/.env.local` using the [provider guide](model-providers.md), then select Live chat. Keep credentials in local configuration, not frontend source or Git.

Clocks and planners remain independent in the engine. The UI separates Guided demo from Live chat; their states never mix. Live chat defaults to real time, begins automatic decisions after the first message, and provides optional simulated time under advanced controls. Real time follows the computer clock and merges missed wakeups into one current-context decision when the page resumes. Switching to Guided demo stops automatic model scheduling. See the [demo guide](demo.md) for details.

Run checks that do not call paid models:

```bash
pnpm test
pnpm typecheck
pnpm lint
```

For real API integration checks, manually run `pnpm model:validate`. This command incurs provider charges and covers six decision scenarios: initial planning, due confirmation, cancellation, a pacemaker, contact suspension, and resumed contact. Inputs and event times are controlled by the test; plans come from the real model. See [bounded real-model validation](model-providers.md#bounded-real-model-validation) for limits, reports, and resumption. Live chat does not share this test command's request cap; monitor ongoing API costs.

## Boundaries of the current implementation

- Model context includes the most recent 40 dialogue messages, all unprocessed user input, and the pending queue. Long-term memory retrieval is not yet connected; application state maintains dialogue and plan continuity.
- Live does not run while the page is closed. Continuous background operation needs reliable server-side state, scheduling, delivery, authentication, rate limits, and cross-device consistency.
- The contact gate accepts an external permission verdict; it does not implement a complete quiet-hours calendar or other policy service.
- Strict JSON output, rule checks, and a real-model run verify different layers. They do not establish appropriate replies for every model and situation. See [protocol conformance traces](protocol-conformance.md) for detailed checks.
