# Proactive AI Timeline Lab

Interactive reference demo for the Proactive AI protocol. It visualizes the conversation stream, mutable future queue, dual simulation/live clocks, dialogue pacemaker, bounded-silence policy, independent user-message arrivals, and decision trace. Rapid arrivals may share one decision snapshot, while input received during inference invalidates the older candidate before commit.

**Guided demo** offers play, pause, next-step, and restart controls instead of free-text input. A bilingual preset story runs through the core engine, showing grouped input, delayed continuation, cancellation, silence, and autonomous re-engagement. It needs no credentials and never calls a model. **Live chat** alone provides a composer and uses a server-side OpenAI-compatible Chat Completions endpoint; API keys are never sent to the browser.

## Run locally

Use Node.js 22.13 or newer and pnpm 11.20.0. From the repository root:

```bash
pnpm install
pnpm dev
```

Copy `.env.example` to `.env.local` to enable a real model.

Live chat defaults to the computer clock; optional simulation and manual advancement are under **Advanced time controls**. Empty sessions make no automatic model requests until the first message. Afterward, due actions and pacemakers may incur API charges while Live chat is active. Switching to Guided demo stops automatic scheduling. Model-only live sessions use separate browser storage; preset scenes and legacy mixed-planner state are never imported into model context. Missed wakes are collapsed into one current-context decision after suspension. This is not a durable background notification service. See the [demo guide](../../docs/en/demo.md).

## Verify

```bash
pnpm --filter @proactive-ai/demo test
```
