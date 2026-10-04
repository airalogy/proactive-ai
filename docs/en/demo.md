# Demo guide

[English](demo.md) | [中文](../zh/demo.md)

The Timeline Lab separates a guided explanation of the mechanism from a real conversation with a language model. Both use the same temporal engine to validate plans, update the queue, and deliver messages.

## Start

Requirements: Node.js 22.13 or newer and pnpm 11.20.0.

```bash
pnpm install
pnpm dev
```

Open `http://localhost:3000`. Guided demo needs no credentials and never calls a model. For Live chat, follow [Model providers](model-providers.md).

## Guided demo

Choose **Play** to watch the complete interview story, **Pause playback** to stop automatic advancement, **Previous step** or **Next step** to review events at your own pace, or **Start over** to reset the story. Previous step pauses playback and restores the earlier messages, queue, clock, contact deadline, and decision trace; you can then step forward or resume playback. It is disabled at the initial state. Playback stops after the final step. Switching languages restarts the guided story in the selected language.

The five steps show:

1. Two independent user arrivals share one decision snapshot. The AI replies and schedules a short continuation, a preparation tip, and a future reconsideration.
2. Five seconds later, the prepared continuation is rechecked and delivered.
3. Forty-five minutes after the start, the user reports that the interview was cancelled and asks for some space. Both remaining intentions are cancelled; the earlier delivered message stays in the history.
4. That afternoon, the dialogue pacemaker opens another decision without new input. The AI chooses silence.
5. Two days after the cancellation, the contact deadline triggers another decision and the AI reopens the conversation without waiting for the user.

Hours and days are compressed into labelled time jumps. Ordinary steps stay on screen for two seconds, while the cancellation step stays for three seconds. The complete playback takes about ten seconds and holds the final frame without looping. Pause or step manually to read at your own pace. These presentation delays are separate from the timestamps in the conversation. Messages, queue statuses, and the decision trace all reflect engine results, not a video or independently animated mock state. A fixed scene planner supplies the proposals; no free-text composer is shown in this mode.

The scenario lives in [guided-demo.ts](../../apps/demo/app/components/guided-demo.ts). The core's general-purpose deterministic demo planner remains available for protocol tests.

## Live chat

Configure a provider, then choose **Live chat**. This mode alone offers free-text input and defaults to the computer's real clock. No automatic model decision runs in an empty session before the first message. After the conversation starts, due queue actions and dialogue-pacemaker events can trigger further model calls even without new input. These calls incur normal provider charges.

Use **Add another** and **Send separately** to prepare a rapid sequence. Each message enters as an independent arrival; nearby arrivals may share one decision snapshot. While a user-triggered model request is pending, further input remains available. A new arrival invalidates an older candidate before it can be committed.

**Advanced time controls** contains the optional simulation clock and manual advancement buttons. Simulated time still uses the real model and may trigger multiple paid requests in one advance. Its session is separate from the real-time session. **Pause** on the contact-policy card blocks autonomous visible messages, not model deliberation or direct replies. To stop automatic scheduling, switch to Guided demo or close the page.

Guided state never enters model context or model-session storage. The real-time model session uses its own browser-storage key; earlier mixed-planner saved sessions are left untouched and are not automatically imported.

## Real-time behavior

Messages and queue timestamps are stored as UTC instants; real-time mode displays them in the computer's local time zone. The live session is saved in browser storage when available. After suspension, the runtime makes one catch-up decision from the latest state rather than replaying every missed pacemaker interval.

Automatic decisions run only while Live chat is active and the page is open. Browser storage may be unavailable, and this demo is not a durable background notification service. A production deployment would attach the same engine to persistent storage and a background scheduler.

## Interface regions

- **Conversation stream** shows user-visible messages; guided messages identify the fictional user as “Example user”.
- **Future queue** shows pending and resolved prepared messages and reconsiderations.
- **Guided controls** show the current step, time jump, and mechanism being demonstrated.
- **Contact-policy card** shows the deadline; its permission control is available in Live chat.
- **Decision trace**, directly below the chat and queue within the same demo area, updates with the conversation and records triggers, queue changes, deliveries, failures, and silence. The static protocol explanation follows the complete demo area.

## Interface translations

User-facing text is managed in [app/i18n/en.ts](../../apps/demo/app/i18n/en.ts) and [app/i18n/zh.ts](../../apps/demo/app/i18n/zh.ts), including interface labels, guided dialogue, scenarios, and decision-trace explanations. Components reference the shared translation entry point; TypeScript and tests check that both catalogs have the same keys and structure. Add new interface text to both catalogs rather than embedding language branches in components. The display layer translates known engine labels without modifying stored records or arbitrary user/model text; original technical errors remain available in expandable details. The shared English paper figures are separate from the bilingual demo interface.

## Verification

```bash
pnpm test
pnpm lint
pnpm build
```

Offline tests execute the complete bilingual guided story through the core engine, check reproducible replay and invalid step ordering, confirm that the guided UI has no composer, and verify that Live chat defaults to real time with collapsed advanced controls. The existing engine and provider-adapter tests cover temporal invariants, input coordination, policy gates, and structured plans without calling a paid model.
