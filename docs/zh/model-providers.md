# 模型提供商

[English](../en/model-providers.md) | [中文](model-providers.md)

Demo 使用模型无关的规划器接口和直接的 OpenAI-compatible Chat Completions 适配器。这是默认兼容层；LiteLLM 是可选网关，不是强制依赖。

## 配置

把 `apps/demo/.env.example` 复制成 `apps/demo/.env.local`，然后设置：

```dotenv
LLM_BASE_URL=https://your-provider.example/v1
LLM_API_KEY=your-server-side-key
LLM_MODEL=your-model
LLM_STRUCTURED_OUTPUT=json_object
```

不要提交 `.env.local`。API Key 只会被服务端路由读取。

配置完成后，可以请求一次真实模型规划：

```bash
pnpm model:smoke
```

冒烟测试会发送一个包含两条中文消息的事件，要求模型返回通过本地验证的时间计划，并且只输出模型元数据与行动数量，不会打印 API Key。格式错误时可能需要第二次 API 请求。

`LLM_STRUCTURED_OUTPUT` 支持：

- `json_schema`：适合完整支持 OpenAI JSON Schema 响应格式的模型；
- `json_object`：兼容性更广的 JSON 模式，并配合本地 Zod 验证；
- `prompt`：供能力有限的兼容接口使用，仅通过提示要求生成 JSON。

无论使用哪种模式，适配器都会在本地解析并验证结果。模型格式错误时，系统会带着简短修复指令重试一次。 JSON 和纯提示模式会在系统提示中提供完整的计划 Schema；严格模式通过 `response_format` 提供。模型拒绝或输出被截断时，不会执行部分计划。

## Qwen 验证目标

阿里云百炼 Model Studio 提供 OpenAI-compatible 接口。中国内地示例：

```dotenv
LLM_BASE_URL=https://dashscope.aliyuncs.com/compatible-mode/v1
LLM_API_KEY=your-dashscope-key
LLM_MODEL=qwen-plus
LLM_STRUCTURED_OUTPUT=json_object
LLM_ADDITIONAL_BODY={"enable_thinking":false}
```

正式论文实验不应使用持续变化的 `qwen-plus` 别名，而应固定具体日期版本，并记录区域、调用日期、参数与重试次数。Qwen 的兼容文档说明，不同模型支持的接口能力和参数可能不同，因此项目保守地默认使用 `json_object` 加本地验证。

参见官方 [Qwen OpenAI 兼容文档](https://help.aliyun.com/zh/model-studio/compatibility-of-openai-with-dashscope)与[结构化输出文档](https://help.aliyun.com/zh/model-studio/qwen-structured-output)。

## OpenAI

```dotenv
LLM_BASE_URL=https://api.openai.com/v1
LLM_API_KEY=your-openai-key
LLM_MODEL=your-supported-model
LLM_STRUCTURED_OUTPUT=json_schema
```

例如，使用较低推理强度测试 GPT-6.1 Sol：

```dotenv
LLM_MODEL=gpt-6.1-sol
LLM_ADDITIONAL_BODY={"reasoning_effort":"low","max_completion_tokens":2048}
```

OpenAI 地址必须配合 OpenAI 密钥使用。从 Qwen 切换时，应同时替换地址、模型、密钥和提供商专用字段，不要只替换密钥。GPT-6.1 Sol 支持结构化输出，以及不含工具调用的 Chat Completions 请求，见[官方模型说明](https://developers.openai.com/api/docs/models/gpt-6.1-sol)。实际访问权限取决于 API 账户。适配器默认不强制设置 temperature；只有模型支持时才应显式配置对应参数。

Strict Structured Outputs 会约束模型输出符合给定 JSON Schema；但本地验证器与队列不变量仍然不可省略。参见 OpenAI 官方的 [Structured Outputs 文档](https://developers.openai.com/api/docs/guides/structured-outputs)。

## 有调用上限的真实模型验证

使用配置的模型进行六次决策的集成检查：

```bash
pnpm model:validate
```

这是单独手动启动的付费测试，不属于 `pnpm test`。每次运行最多发送 **10 次 HTTP 请求（包括格式修复重试）**，每次最多 **2,048 个 completion token**。输入 token 同样计费，因此这不是固定金额预算。接口需支持 `max_completion_tokens`。输出额度较低可能导致截断，测试会报告失败，不会自动提高额度。HTTP 错误、模型无访问权限或状态转移失败都会停止测试，不循环重试。失败后继续运行时，可用 `MODEL_TEST_MAX_REQUESTS`（1--10）降低剩余调用额度。例如 `MODEL_TEST_MAX_REQUESTS=7 pnpm model:validate` 最多再尝试七次；重新启动命令并不意味着用户授权的总额度重新计算。

如果初始模型计划已成功，但后续请求失败，可将 `MODEL_TEST_RESUME_REPORT` 设为原始的 `tmp/model-validation/*.json` 报告路径，直接重放保存的初始计划，不再为这一步调用 API。运行器会核对模型、接口地址、用户输入和计划结构；后续决策仍调用真实模型，新报告明确记录来源报告及初始计划重放标记。继续前应将 `MODEL_TEST_MAX_REQUESTS` 降至剩余授权次数。

如果直连超时，但电脑已配置 `HTTPS_PROXY`，支持 `--use-env-proxy` 的 Node 版本可以显式使用已有代理（已用 Node 22.23.2 验证）：

```bash
MODEL_TEST_MAX_REQUESTS=7 node --use-env-proxy --env-file=apps/demo/.env.local --import tsx scripts/model-validate.ts
```

排查连接时不要打印环境变量或密钥。如果提供商返回 `insufficient_quota` / `credit_balance_exhausted`，需要处理 API 账户余额，重复推理请求无法解决。这类响应也不能证明账户已获得目标模型的访问权限。

测试使用合成的中文输入和加速推进的事件时间：

1. 请求多条回复、一项预备消息和稍后的重新判断。
2. 在情境不变的分支中检查到期消息是否经过确认后发送。
3. 回到同一份初始模型计划，在发送前取消面试，检查旧计划是否撤销。
4. 在联系截止时间之前、没有新输入时唤醒规划器；发言或沉默均有效，报告记录实际选择。
5. 在截止时间暂停联系，检查保持沉默的同时是否保留联系义务。
6. 恢复许可，检查没有新用户消息时是否重新发起联系。

每份候选计划都来自模型，不会用脚本化演示规划器补造缺失行为。报告保存在 Git 忽略的 `tmp/model-validation/` 中，包括计划、可见消息、队列状态、请求次数、延迟，以及提供商返回的 token 用量。报告不记录密钥或请求头，也不会自动公开或写入论文。这些检查验证集成行为，不代表回复质量、用户价值或后台持续运行一整天已经得到验证。

现有 Live Demo 由浏览器驱动：使用真实时钟并在本地持久保存状态，恢复页面后合并错过的唤醒；关闭页面期间不会继续运行。本地 Demo API 在作为公开付费模型服务部署之前，还需要增加身份验证和限流。

## LiteLLM 网关

当部署需要集中式路由、模型别名、失败回退、预算控制或提供商可观测性时，可以选择 LiteLLM：

```dotenv
LLM_BASE_URL=http://localhost:4000/v1
LLM_API_KEY=your-litellm-key
LLM_MODEL=proactive-planner
LLM_STRUCTURED_OUTPUT=json_object
```

应用本身不引入 LiteLLM SDK，而是通过相同的 OpenAI-compatible 协议与代理通信。因此，最简单的直接连接模型路径仍然保留。参见 [LiteLLM Proxy 文档](https://docs.litellm.ai/)。

## 可选的提供商字段

可以通过 JSON 对象增加提供商特有的顶层请求字段：

```dotenv
LLM_ADDITIONAL_BODY={"enable_thinking":false}
```

`model`、`messages`、`stream` 与 `response_format` 等保留字段不能通过该配置覆盖。

## 可复现性记录

正式报告每次模型实验时，应记录：

1. 提供商、区域、接口协议和日期；
2. 完整模型 ID 或版本快照；
3. temperature 与结构化输出模式；
4. 系统提示词与 JSON Schema 版本；
5. 适配器重试次数与传输错误；
6. 全部确定性引擎策略。
