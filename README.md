# Proactive AI

[English](README.md) | [中文](README.zh.md)

> AI that does not stop existing when the user stops typing.

Proactive AI is an open-source exploration of asynchronous, continuous, and self-initiated AI conversation.

![Proactive AI: From Turns to Timelines](apps/demo/public/og.png)

Most AI chat systems follow a strict request-response loop: a user sends a message, the AI returns one answer, and then it waits. Human conversations do not work like that. People may send several messages in a row, reply much later, leave a message unanswered, return to an earlier topic, or start a new conversation without being prompted.

Proactive AI explores a different model: the conversation is a continuous timeline, and every user message is an event the AI may observe—not a request that must receive an immediate answer.

## Core ideas

### 1. Temporal response queue

The AI may produce zero, one, or multiple messages. A message can be sent now or placed in a mutable time queue for later delivery.

Queued items are not immutable promises. Before delivery, they may be kept, edited, postponed, or cancelled when the conversation changes.

The queue supports two kinds of future action:

- `send_message`: deliver prepared content after its earliest allowed time.
- `reconsider`: wake up later and decide then whether anything should be said.

### 2. Dialogue pacemaker

When the user says nothing, a periodic pacemaker can wake the AI so it can review recent conversation, long-term memory, pending queue items, and the passage of time.

Waking up does not require speaking. The AI may remain silent, add a future action, reschedule an existing one, or proactively begin a conversation.

### 3. Bounded silence

An optional contact deadline prevents every pacemaker decision from ending in silence forever. Before the deadline the AI may remain silent; afterward, the runtime requires the next valid plan to produce a visible message when external policy permits proactive contact. Users can pause or disable this behavior.

### 4. Event-driven replanning

Three events can cause the AI to reconsider its plan:

1. The user sends a new message.
2. The dialogue pacemaker fires.
3. A queued item reaches its scheduled time.

On every trigger, the AI can reconcile the current conversation with its pending queue before taking action.

Each user send is recorded as its own arrival event. A send requests a new decision, but it does not imply one model call or one visible reply. Nearby arrivals may share a decision snapshot; input that arrives while inference is running invalidates the older candidate before it can be committed.

## Goal

The first goal of Proactive AI is to answer this question:

> If an AI can decide when to observe, remain silent, reply, think again, or initiate a conversation, can human-AI communication become more natural and continuous than traditional turn-based chat?

The project aims to reproduce the timing, rhythm, continuity, and initiative of human conversation—not to misrepresent an AI as a human. Users should know they are interacting with AI and remain able to inspect, limit, or disable its proactive behavior.

## Working prototype

The repository now contains an executable TypeScript protocol, deterministic timeline engine, OpenAI-compatible model adapter, bilingual interactive demo, automated tests, and an ACM LaTeX research paper draft.

Start with [How it works](docs/en/implementation.md) for an implementation walkthrough: a complete JSON plan, model decisions, time queues, dialogue pacemaking, delivery-time checks, and the corresponding code.

Read the paper sources in [English](paper/main.tex) or [Chinese](paper/main_zh.tex). See the [paper build instructions](paper/README.md) to generate local PDFs. For author revision, use the complete Chinese LaTeX working manuscript; accepted Chinese changes can then be synchronized back to the English LaTeX source.

Requirements: Node.js 22.13 or newer and pnpm 11.20.0. The repository's `packageManager` field allows Corepack to select the expected pnpm version.

```bash
pnpm install
pnpm dev
```

Open `http://localhost:3000`. **Guided demo** plays a preset story through the actual engine without an API key. To connect Qwen, OpenAI, or a LiteLLM gateway, copy `apps/demo/.env.example` to `apps/demo/.env.local` and follow the [provider guide](docs/en/model-providers.md).

The Timeline Lab separates **Guided demo** (play, pause, step, and restart) from **Live chat** (free-text conversation with the configured model). Live chat defaults to the computer clock; optional simulated time lives under advanced controls. The guided and model sessions stay separate. Automatic model decisions begin after the first message, run while Live chat is active, and can incur API charges without new input. See the [demo guide](docs/en/demo.md) for storage and scheduling boundaries.

After configuring a provider, validate one real model call with `pnpm model:smoke`.

## Repository

```text
apps/demo       Interactive Timeline Lab
packages/core   Protocol, engine, planners, and provider adapter
docs/en         English documentation
docs/zh         Simplified Chinese documentation
paper           ACM LaTeX manuscript
```

Run all verification commands with:

```bash
pnpm test
pnpm lint
pnpm build
```

Read the [documentation](docs/en/README.md) or start with the [core concepts](docs/en/core-concepts.md) for the current behavioral model. The precise executable contract is in the [temporal conversation protocol](docs/en/protocol.md).

## License

The project-authored software and developer documentation are licensed under [Apache-2.0](LICENSE). See [NOTICE](NOTICE) for attribution information. The manuscript and paper-specific illustrations are excluded from this software license; see [paper licensing](paper/LICENSE.md). Third-party files retain their original licenses.
