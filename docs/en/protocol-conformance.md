# Protocol conformance traces

[English](protocol-conformance.md) | [中文](../zh/protocol-conformance.md)

These event traces check whether the research prototype follows the [temporal conversation protocol](protocol.md). The table summarizes event sequences and expected state changes for inspecting queue revisions, delivery conditions, and external contact policy.

## Checklist

| Property | Event sequence | Expected outcome |
| --- | --- | --- |
| Variable message counts | One user event | Zero-to-many immediate messages and future plans are valid |
| Context interruption | Planned follow-up; user changes the premise before delivery | Affected intentions are revised and stale text is not delivered |
| Delivery-time validation | A prepared message becomes due | Delivery occurs only after confirmation against current context |
| Stable delivery order | The model accepts overdue actions in reverse order | The runtime delivers by eligibility time, then stable ID, without duplicate delivery |
| Deliberate silence | Dialogue pacemaker without a grounded reason to speak | The transition succeeds with no visible message |
| Bounded silence | Repeated silent wakeups followed by the contact deadline | Silence is valid before the deadline; the next valid plan after it produces visible output |
| Policy suspension | Deadline reached while proactive contact is paused, then resumed | Autonomous output is blocked while paused; the deadline remains and is fulfilled after contact is allowed |
| Input coalescing | Several user messages arrive independently within a short interval | Every arrival remains distinct, but the planner observes their ordered list in one snapshot |
| Inference interruption | Another message arrives before an older plan completes | The older candidate emits nothing and planning restarts from all unprocessed input |
| Invalid plan | A plan leaves a due action unresolved | No visible action occurs and the due item remains recoverable |
| Plan conflict | A structurally valid plan violates a queue invariant | Candidate output and revisions are rejected; recovery may update retry times |
| Failed-input recovery | A user-triggered plan fails, then a timed retry occurs | Input remains unprocessed until a valid plan commits; the coordinator does not spin |
| Deadline wakeup | The contact deadline precedes the next regular pulse, with no queued action | The pacemaker advances to the deadline and requests a decision without user input |

## Key traces

In the context-interruption trace, an initial event creates a prepared message and a future reconsideration; a later user update invalidates their premise before either is executed. The subsequent transition removes both intentions, so advancing beyond their original eligibility times produces no delivery. The behavior follows from updating the related future actions together rather than assuming that the language model will remember to retract stale content.

Other traces cover plan rejection and bounded silence. A plan that leaves a due action unresolved or proposes incompatible revisions produces no candidate output or queue changes. Recovery retains unprocessed input and pending actions while advancing retry times. Pacemaker wakeups before the contact deadline may remain silent; after the deadline, a silence-only candidate cannot clear the contact requirement. External policy can postpone contact without granting the planner authority to bypass user control.

## Reproduction

After installing dependencies, run the core tests from the repository root:

```bash
pnpm --filter @proactive-ai/core test
```

The [engine tests](../../packages/core/test/engine.test.ts) contain reproducible event sequences and state assertions. The [model-adapter tests](../../packages/core/test/openai-compatible.test.ts) use mocked responses to check structured-plan parsing and error handling; they do not call a live model or require an API key.

The bounded real-provider trajectory runner is separate: see [model validation](model-providers.md#bounded-real-model-validation). Its user inputs and event times are controlled, but its candidate plans come from the configured model; missing behaviors are reported rather than scripted into the result. Ordinary tests never call the paid API.

To inspect message and queue changes in the interface, follow the simulation-time walkthrough in the [demo guide](demo.md).
