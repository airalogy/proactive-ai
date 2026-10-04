# Proactive AI 文档

[English](../en/README.md) | [中文](README.md)

本目录包含 Proactive AI 的简体中文文档。

## 从这里开始

- [核心概念](core-concepts.md)：持续对话时间线、可变回复时间队列、对话起搏器、有界沉默和事件驱动的重新排程模型。
- [实现原理](implementation.md)：从一个完整 JSON 计划看大模型、消息队列、对话起搏器和执行层如何协作，附代码入口与运行方式。
- [时间对话协议](protocol.md)：可执行的状态、事件、规划输出、队列修改与原子发送语义。
- [协议一致性轨迹](protocol-conformance.md)：事件序列、预期状态变化与复现方式。
- [系统架构](architecture.md)：monorepo 结构、运行边界与确定性职责。
- [Demo 使用指南](demo.md)：如何运行并演示每一种核心行为。
- [模型提供商](model-providers.md)：Qwen、OpenAI 与可选 LiteLLM 配置。
- [现有工作及其区别](related-work.md)：详细比较主动对话研究、回复时机模型、持续 Agent、开源实现和商业产品。
