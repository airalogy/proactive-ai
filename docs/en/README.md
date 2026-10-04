# Proactive AI documentation

[English](README.md) | [中文](../zh/README.md)

This directory contains the English documentation for Proactive AI.

## Start here

- [Core concepts](core-concepts.md): the continuous conversation timeline, mutable temporal response queue, dialogue pacemaker, bounded silence, and event-driven replanning model.
- [How it works](implementation.md): an end-to-end explanation of JSON plans, the model, queue, pacemaker, and runtime, with code entry points and commands.
- [Temporal conversation protocol](protocol.md): executable state, event, planner output, queue mutation, and atomic delivery semantics.
- [Protocol conformance traces](protocol-conformance.md): event sequences, expected state changes, and reproduction instructions.
- [Architecture](architecture.md): monorepo structure, runtime boundaries, and deterministic responsibilities.
- [Demo guide](demo.md): how to run and demonstrate every core behavior.
- [Model providers](model-providers.md): Qwen, OpenAI, and optional LiteLLM configuration.
- [Related work and differences](related-work.md): detailed comparison with proactive dialogue research, timing models, persistent agents, open-source implementations, and commercial products.
