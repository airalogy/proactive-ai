# Architecture

[English](architecture.md) | [中文](../zh/architecture.md)

Proactive AI is a small TypeScript monorepo with a model-neutral core and an interactive web reference implementation.

```text
proactive-ai/
├── apps/
│   └── demo/                 # Next.js/vinext timeline lab
├── packages/
│   └── core/                 # protocol, engine, planners, provider adapter
├── docs/
│   ├── en/
│   └── zh/
└── paper/                    # ACM LaTeX manuscript
```

## Runtime flow

```text
independent user arrivals ─> coordinator ─┐
pacemaker ────────────────────────────────┼─> deterministic engine ─> planner context
queue becomes due ────────────────────────┘                              │
                                                 ├─ deterministic demo planner
                                                 └─ server-side model adapter
                                                          │
                                      OpenAI-compatible /chat/completions
                                                          │
                                     OpenAI · Qwen · LiteLLM · compatible APIs

planner JSON -> schema + queue + contact-policy validation
             -> atomic state transition -> visible messages + revised state
```

`packages/core` owns all decisions about time and queue state. The language model proposes a plan; it cannot directly send a message, mutate persistence, or calculate authoritative timestamps.

## Core modules

- `protocol.ts` defines the strict planner output schema and portable JSON Schema.
- `engine.ts` implements independent input arrival, decision coalescing, stale-snapshot rejection, logical time, queue lifecycle, atomic application, and fail-closed recovery.
- `demo-planner.ts` provides deterministic, bilingual scenarios for tests and demonstrations.
- `openai-compatible.ts` calls Chat Completions, requests structured output, retries malformed model output once, and validates the result locally.

## Demo modes

The engine keeps clocks and planners independent, while the user interface presents two distinct experiences. Guided demo advances a fixed story through the actual engine with playback controls and no composer. Live chat uses the configured model, defaults to real time, and offers simulated time under advanced controls. Their states never mix.

The guided scene planner supplies reproducible proposals without model requests. The core deterministic planner remains available for protocol tests. Live chat starts automatic scheduling after its first message, persists its real-time session in separate browser storage, and collapses missed wakes into one current-context decision after suspension.

Live chat posts the planner context to `/api/plan`. The server reads credentials from environment variables, calls the configured provider, and returns only the validated temporal plan. The browser never receives the API key. Switching back to Guided demo unmounts the model session and stops its automatic scheduling.

The browser live-time driver demonstrates wall-clock semantics while the page is active. Durable background delivery remains a deployment concern: a production service must provide persistent state, a reliable scheduler, and an external delivery channel.

## Provider boundary

The core `Planner` is a function from `PlannerContext` to `PlannerOutput`. This small interface is the stable boundary. The default remote implementation uses OpenAI-compatible Chat Completions because it is supported by OpenAI, Qwen, and LiteLLM. A future Responses API adapter can implement the same interface without changing the engine or demo.

## Deterministic responsibilities

The engine—not the model—owns:

- the current time and conversion of relative delays;
- unique identifiers and stable ordering;
- coalescing nearby arrivals into a decision snapshot;
- rejecting a candidate if input changes during inference;
- due-action detection;
- wall-clock wake scheduling and single-decision catch-up after suspension;
- validation that every due item is resolved exactly once;
- atomic application of all queue changes;
- failure recovery and retry timing;
- bounded-silence deadlines and the external proactive-contact gate;
- the final act of message delivery.

This boundary makes provider changes less risky and gives the research prototype reproducible semantics even when model outputs remain stochastic.

## User control and privacy in deployment

Deploying the prototype as a service requires the following controls. These are deployment requirements, not a list of features already implemented in the demo:

- Users can pause proactive contact and inspect or revoke future actions. Contact deadlines cannot override user authorization, quiet hours, rate limits, or domain-specific safety rules.
- Unsent content, memory, and action rationales may contain personal information. Limit retention periods and retrieval scope, apply encryption and access controls to persisted data, and provide inspection and deletion controls. Action rationales need only record brief operational grounds; the system should not request or persist hidden model reasoning.
- The interface clearly identifies the system as AI. Humanlike expression must not impersonate a person or pressure users to respond through guilt-inducing messages.
