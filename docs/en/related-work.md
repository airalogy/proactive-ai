# Related work and how Proactive AI differs

[English](related-work.md) | [中文](../zh/related-work.md)

Last reviewed: 2026-07-31

This document maps the closest published research, open-source systems, and commercial products to the specific interaction model proposed by Proactive AI. It is an initial technical literature review, not an exhaustive patent search or a final claim of academic novelty.

## The Proactive AI model used for comparison

Proactive AI treats a conversation as a continuous, asynchronous timeline rather than a sequence of mandatory user-assistant turns.

At any deliberation, the AI may observe zero, one, or multiple new user messages. It may remain silent, send one or more messages immediately, place one or more messages into a future queue, or schedule a future reconsideration without preparing the final wording yet.

The pending queue is mutable. Three events invoke the same replanning loop:

1. a new user message arrives;
2. the periodic deliberation pacemaker fires; or
3. a queued action reaches its earliest eligible time.

The planner then keeps, edits, postpones, cancels, reorders, or adds pending actions before deciding what to send now.

A compact formulation is:

```text
state S(t) = conversation history + memory + current time + pending queue
event e(t) = user_message | pacemaker | queue_due

planner π(S(t), e(t))
  -> immediate actions + queue mutations + next wakeup
```

This definition is deliberately narrower than the general term *proactive AI*. The distinctive object is the **replannable temporal conversation queue**.

## Comparison at a glance

| Work | Main form of proactivity | Treatment of time | Output model | Difference from Proactive AI |
| --- | --- | --- | --- | --- |
| [StalemateBreaker](https://arxiv.org/abs/1604.04358) (2016) | Introduces new content when a live conversation stalls | Current dialogue context | One selected reply | No autonomous wakeup or future queue |
| [Proactive Human-Machine Conversation / DuConv](https://arxiv.org/abs/1906.05572) (2019) | Leads a conversation toward explicit topic goals | Turn sequence | One response per turn | Plans topic direction, not wall-clock speech |
| [When to Talk](https://arxiv.org/abs/1912.09879) (2019) | Decides whether the chatbot should continue speaking or remain silent | Relative order inside an active session | One generated utterance or silence | No long-horizon delayed delivery or mutable queue |
| [Wait, I'm Still Talking!](https://arxiv.org/abs/2002.09616) (2020) | Waits when a user's sequence of short messages appears incomplete | Short-term incoming-message boundary | Wait or reply now | Models when the user has finished, not autonomous future speech |
| [Neural Generation of Dialogue Response Timings](https://aclanthology.org/2020.acl-main.221/) (2020) | Predicts natural spoken response offsets | Millisecond/second-scale spoken timing | Timed spoken response | No initiative, pacemaker, or queue reconciliation |
| [Generative Agents](https://arxiv.org/abs/2304.03442) (2023) | Agents remember, plan, reflect, and initiate conversations | Simulated daily time | Planned behavior in a virtual world | Not an asynchronous human-AI messaging protocol |
| [Mind the Gap / GapChat](https://arxiv.org/abs/2310.15415) (2023) | Uses elapsed time to choose relevant topics across sessions | Hours to months between sessions | Response after a new session begins | Time is generation context, not a trigger or pending plan |
| [Inner Thoughts](https://arxiv.org/abs/2501.00383) (CHI 2025) | Forms covert thoughts and speaks when intrinsic motivation is high | Real-time, event/turn-oriented participation | Selected thought becomes an utterance | No explicit wall-clock queue of revisable future messages |
| [X-TURING](https://aclanthology.org/2025.acl-long.293/) (ACL 2025) | Represents burst dialogue in which both parties send consecutive timestamped messages | Timestamps inside generated/evaluation transcripts | Multiple consecutive messages | Closest surface form, but no online persistent queue or interruption-driven replanning semantics |
| [ProactiveAgent](https://github.com/leomariga/ProactiveAgent) | Periodically wakes, decides whether to respond, and dynamically chooses the next sleep interval | Wall-clock wake/sleep loop | One immediately generated response per positive decision | Has a pacemaker, but not a zero-to-many future message queue |
| Character.AI, Replika, and Nomi | Send contextual messages while the user is away | Product-controlled notification cadence | Proprietary proactive message generation | Similar user-facing behavior, but scheduling and replanning internals are not public |

## 1. Mixed-initiative and goal-directed dialogue

Mixed-initiative dialogue predates large language models. Its central question is who currently controls the direction of a conversation. A system is called proactive when it introduces information, asks clarifying questions, changes topics, or guides the user toward a system-side goal instead of only answering the most recent request.

### StalemateBreaker

[StalemateBreaker](https://arxiv.org/abs/1604.04358) identifies a stalemate in open-domain conversation and introduces new content drawn from external knowledge. Its pipeline asks when new content is needed, what content should be introduced, and how to rank candidate replies. The contribution is conversational initiative and topic continuation inside a live session.

Its concept of "when" is a dialogue-state decision, not a future wall-clock time. It does not maintain unsent utterances that may later be revised after new events.

### DuConv and goal-directed proactive dialogue

[Proactive Human-Machine Conversation with Explicit Conversation Goals](https://arxiv.org/abs/1906.05572) introduced the DuConv dataset. A conversation leader follows a knowledge-graph path, introduces or maintains topics, and attempts to reach a predefined target naturally. Later proactive dialogue work similarly focuses on target planning, clarification, persuasion, recommendation, emotional support, and task completion.

The [2023 survey of proactive dialogue systems](https://arxiv.org/abs/2305.02750) defines proactivity primarily as creating or controlling the conversation and anticipating effects on the user. [ProactiveEval](https://aclanthology.org/2026.acl-long.1906/) (ACL 2026), for example, evaluates target planning and dialogue guidance across multiple domains.

These works are important prior art for the broad claim that AI can take initiative. They generally retain the turn-based assumption: a proactive policy changes the content or direction of the next response, but does not represent future speech as a mutable wall-clock plan.

## 2. Turn-taking, waiting, and response timing

This line of work is closer to the observation that instant messaging is not a strict one-message-in, one-message-out protocol.

### When to Talk

[When to Talk](https://arxiv.org/abs/1912.09879) adds a decision module to an open-domain dialogue model. When the last utterance came from the chatbot, the model decides whether to continue speaking or remain silent. The authors modify dialogue data to represent empty turns and evaluate both response generation and the accuracy of the speak/silence decision.

This establishes important prior art: a chatbot need not wait for another user utterance before continuing. However, the decision is made inside an active multi-turn session. It does not plan messages for minutes or hours later, and there is no persistent queue to reconcile when the user interrupts.

### Wait, I'm Still Talking!

[Wait, I'm Still Talking!](https://arxiv.org/abs/2002.09616) starts from the same instant-messaging observation as Proactive AI: people often split a single thought across several short messages. Its Imagine-Then-Arbitrate model imagines possible next utterances from both sides, then decides whether the agent should wait for more user input or answer immediately.

This work is especially relevant to the input side of Proactive AI. It models whether one or several incoming messages form a complete unit. It does not model a variable-length set of outgoing messages with different future delivery times.

### X-TURING and burst dialogue

[X-TURING](https://aclanthology.org/2025.acl-long.293/) directly challenges the one-message-per-turn convention. Its long-term Turing-test setting lets both the user and response side send multiple consecutive messages, labels the messages with timestamps, and prompts generated bursts to imitate human intervals. It is therefore the closest published work to Proactive AI's visible transcript form.

Its purpose is evaluation and pseudo-dialogue construction. The timestamps are represented inside a generated transcript; the work does not specify an online scheduler that persists several unsent actions, wakes when each becomes due, or atomically cancels those actions when new user input changes the context. Proactive AI should not claim novelty for burst output itself. Its narrower claim is the execution and replanning semantics underneath such a burst.

### Response timing and full-duplex dialogue

[Neural Generation of Dialogue Response Timings](https://aclanthology.org/2020.acl-main.221/) learns distributions over spoken response offsets and shows that context-sensitive timing can sound more natural than fixed timing. More recent systems such as Microsoft's [RESPOND](https://www.microsoft.com/en-us/research/publication/respond-responsive-engagement-strategy-for-predictive-orchestration-and-dialogue/) continuously predict when and how to produce backchannels or claim a turn while a user is still speaking.

These systems study fine-grained timing within synchronous voice interaction. Proactive AI instead focuses on asynchronous text conversation across seconds, minutes, hours, or days, including periods in which neither party is actively holding a conversational turn.

## 3. Time-aware and persistent agents

### GapChat

[Mind the Gap Between Conversations](https://arxiv.org/abs/2310.15415) introduces GapChat, where conversations are separated by simulated gaps ranging from short intervals to months. Models receive information about elapsed time, ongoing events, and expected event progress. Human evaluation shows that time awareness improves topic relevance and informativeness.

GapChat demonstrates that elapsed time is semantically meaningful. Its model is still invoked when a new conversation session begins; elapsed time does not itself wake the agent or cause it to create, revise, or deliver pending speech.

### Generative Agents

[Generative Agents](https://arxiv.org/abs/2304.03442) combines a memory stream, retrieval, reflection, and planning to produce believable agents in a simulated town. Twenty-five agents follow daily plans, observe one another, form relationships, and initiate conversations. This is strong prior art for agents that persist through time and act without direct user prompts.

The unit of planning is general behavior in a simulated environment. Proactive AI narrows the problem to one persistent human-AI messaging relationship and makes pending linguistic actions explicit, inspectable, and revisable.

## 4. Continuous inner thought and proactive participation

The closest academic work is [Proactive Conversational Agents with Inner Thoughts](https://arxiv.org/abs/2501.00383), published at CHI 2025, with the open-source [thoughtful-agents](https://github.com/xybruceliu/thoughtful-agents) framework.

Its framework contains five stages:

1. trigger a thought process;
2. retrieve relevant memories and context;
3. form candidate thoughts;
4. evaluate the intrinsic motivation to express them; and
5. decide whether and how to participate.

The implementation distinguishes fast and deliberate thoughts, stores thoughts and memories as mental objects, scores their saliency and motivation, predicts turn allocation, and selects a participant and utterance. The paper's formative study and user evaluations examine anthropomorphism, coherence, intelligence, and turn-taking appropriateness in multi-party interaction.

This overlaps strongly with the idea that an AI can think without immediately speaking and can decide to hold back a thought. The main distinction is the temporal execution model. The public implementation processes conversation events and selects the next speaker; it does not expose a durable wall-clock queue containing multiple future utterances and reconsideration events that are replanned when time or conversation changes.

## 5. Engineering systems and commercial products

### ProactiveAgent

The open-source [ProactiveAgent](https://github.com/leomariga/ProactiveAgent) library is the closest engineering implementation of the pacemaker concept. Its agent:

- records conversation history and the last user-message time;
- chooses a dynamic sleep interval;
- wakes after that interval and decides whether a response is warranted;
- can enforce minimum and maximum response intervals; and
- interrupts its current sleep when a new user message arrives, causing an immediate decision and a recalculation of the next sleep.

In the current public implementation, a positive decision calls the provider once, obtains one response string, appends it to history, and immediately invokes response callbacks. The scheduler represents the next wakeup, not a collection of independently scheduled future messages. Therefore it already implements much of the pacemaker and interruption mechanism, but not Proactive AI's mutable zero-to-many response plan.

### Character.AI, Replika, and Nomi

Commercial AI companions already demonstrate that proactive outreach is a real product behavior:

- [Character.AI Away Messages](https://blog.character.ai/ama-recap-and-january-2024-faq/) allow a character to message a user who is not in the app.
- [Replika notifications](https://help.replika.com/hc/en-us/articles/360027515872-How-do-I-set-up-my-app-s-notifications) can contain check-ins or follow-ups grounded in previous conversation.
- [Nomi Proactive Messaging](https://wiki.nomi.ai/When_Your_Nomi_Messages_You_First) lets users select an approximate cadence; if the user does not respond, the interval can grow, and quiet hours suppress outreach.

These products overlap at the user-experience level. Their public materials do not describe whether messages are pre-generated, whether several future messages share a queue, or whether new input atomically replans all pending speech. They are evidence that proactive messaging itself is not a defensible novelty claim, but they do not eliminate the research opportunity around a transparent and formally evaluated scheduling model.

## The exact distinction

The closest existing designs can be summarized as:

```text
turn-taking model:
  context -> speak now or wait

heartbeat agent:
  sleep -> wake -> speak now or wait -> choose next sleep

Proactive AI:
  any event -> reconcile a persistent future-speech plan
            -> send zero-to-many messages now
            -> mutate zero-to-many future actions
            -> schedule the next deliberation
```

Proactive AI's queue contains at least two action types:

```json
{
  "actions": [
    {
      "type": "send_message",
      "content": "I thought of one more thing.",
      "not_before": "2026-07-31T15:02:00+08:00"
    },
    {
      "type": "reconsider",
      "reason": "Check whether this topic is still worth following up",
      "not_before": "2026-07-31T20:00:00+08:00"
    }
  ]
}
```

For short message bursts, content may be prepared in advance. For longer delays, `reconsider` avoids committing to wording that may become stale. New user input can invalidate either type before execution.

## Implications for a paper

The following claims are **not** novel enough:

- an AI can proactively lead a conversation;
- an AI can initiate contact without a new user message;
- an AI can decide to remain silent;
- an AI can delay a response;
- an AI can represent several consecutive timestamped messages;
- an AI agent can wake periodically;
- memory can support long-term conversation.

A defensible candidate contribution is:

> A unified event-driven model for asynchronous LLM conversation in which pending utterances are first-class mutable temporal actions, and every user message, periodic wakeup, or due action can jointly replan future speech.

The paper should test the architecture rather than rely on a "first ever" claim. Useful comparisons include:

1. immediate one-response-per-user-message chat;
2. a wait-or-reply turn-taking model;
3. a heartbeat agent that can emit one immediate response;
4. an immutable delayed-message queue; and
5. the full mutable queue with event-driven replanning.

Key outcomes include premature interruption, stale-message rate, cancellation accuracy, timing appropriateness, coherence, perceived continuity, helpfulness, annoyance, user control, wakeup frequency, and inference cost.

The current paper title is:

> **Proactive AI: From Turns to Replannable Dialogue Timelines**

Before making a formal "first" claim, the review should be extended with backward and forward citation tracing, searches in ACM/IEEE/Scopus/Web of Science, a dedicated patent search, and direct behavioral testing of comparable products whose internal designs are not public.
