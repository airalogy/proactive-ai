# Model providers

[English](model-providers.md) | [中文](../zh/model-providers.md)

The demo uses a provider-neutral planner interface and a direct OpenAI-compatible Chat Completions adapter. This is the default compatibility layer; LiteLLM is optional, not a required dependency.

## Configuration

Copy `apps/demo/.env.example` to `apps/demo/.env.local` and set:

```dotenv
LLM_BASE_URL=https://your-provider.example/v1
LLM_API_KEY=your-server-side-key
LLM_MODEL=your-model
LLM_STRUCTURED_OUTPUT=json_object
```

Never commit `.env.local`. The API key is read only by the server route.

After configuration, request one real planning decision with:

```bash
pnpm model:smoke
```

The smoke test sends a two-message Chinese event, requires a locally valid temporal plan, and prints only model metadata and action counts. It never prints the API key. A malformed output may require a second API request.

`LLM_STRUCTURED_OUTPUT` accepts:

- `json_schema`: strict structured output for providers that fully support the OpenAI JSON Schema response format;
- `json_object`: widely compatible JSON mode plus local Zod validation;
- `prompt`: prompt-only JSON generation for limited compatible endpoints.

Regardless of provider mode, the adapter parses and validates output locally. Malformed output is retried once with a compact repair instruction. JSON and prompt-only modes include the full plan schema in the system prompt; strict mode supplies it through `response_format`. Refused or truncated responses are rejected without executing a partial plan.

## Qwen validation target

Alibaba Cloud Model Studio exposes an OpenAI-compatible endpoint. A mainland China example is:

```dotenv
LLM_BASE_URL=https://dashscope.aliyuncs.com/compatible-mode/v1
LLM_API_KEY=your-dashscope-key
LLM_MODEL=qwen-plus
LLM_STRUCTURED_OUTPUT=json_object
LLM_ADDITIONAL_BODY={"enable_thinking":false}
```

For paper experiments, replace moving aliases such as `qwen-plus` with the exact dated model snapshot and record the region, date, parameters, and retry count. Qwen's compatibility documentation notes that endpoint features and accepted parameters may differ by model, which is why `json_object` plus local validation is the conservative default.

See the official [Qwen OpenAI compatibility documentation](https://www.alibabacloud.com/help/en/model-studio/compatibility-of-openai-with-dashscope) and [structured output documentation](https://www.alibabacloud.com/help/en/model-studio/qwen-structured-output).

## OpenAI

```dotenv
LLM_BASE_URL=https://api.openai.com/v1
LLM_API_KEY=your-openai-key
LLM_MODEL=your-supported-model
LLM_STRUCTURED_OUTPUT=json_schema
```

For example, to test GPT-6.1 Sol with low reasoning effort:

```dotenv
LLM_MODEL=gpt-6.1-sol
LLM_ADDITIONAL_BODY={"reasoning_effort":"low","max_completion_tokens":2048}
```

Use the OpenAI endpoint and an OpenAI key together; when switching from Qwen, replace the endpoint, model, key, and provider-specific fields, not just the key. GPT-6.1 Sol supports structured output and Chat Completions without tools. See its [official model page](https://developers.openai.com/api/docs/models/gpt-6.1-sol). Model access depends on the API account. The adapter does not force a temperature; explicit parameters may be supplied only when supported by the chosen model.

Strict Structured Outputs constrain model output to the supplied JSON Schema; the local validator and queue invariants still remain mandatory. See the official [OpenAI Structured Outputs guide](https://developers.openai.com/api/docs/guides/structured-outputs).

## Bounded real-model validation

For a six-decision integration check with the configured model, run:

```bash
pnpm model:validate
```

This is a paid, manually invoked test, separate from `pnpm test`. Each invocation allows at most **10 HTTP requests including schema-repair retries**, with at most **2,048 completion tokens per request**. Input tokens are also billable; these are request/token limits, not a fixed monetary budget. The runner requires an endpoint that accepts `max_completion_tokens`. A short output budget may cause truncation; it is reported as a failure, never silently increased. HTTP failures, model-access errors, and failed state transitions stop the run instead of triggering a loop. When resuming after failed attempts, lower the remaining request allowance with `MODEL_TEST_MAX_REQUESTS` (1--10). For example, `MODEL_TEST_MAX_REQUESTS=7 pnpm model:validate` permits at most seven more attempts; restarting the command does not grant a new user-approved budget.

If the initial model plan succeeded but a later request failed, set `MODEL_TEST_RESUME_REPORT` to that original `tmp/model-validation/*.json` report to replay the saved initial plan without another API call. The runner checks the model, endpoint, input messages, and plan schema before replay. Later decisions still call the model, and the new report explicitly records the source report and which initial plan was replayed. Reduce `MODEL_TEST_MAX_REQUESTS` to the remaining allowance before resuming.

If direct connections time out but the machine has an existing `HTTPS_PROXY`, Node versions exposing `--use-env-proxy` can opt in explicitly (verified with Node 22.23.2):

```bash
MODEL_TEST_MAX_REQUESTS=7 node --use-env-proxy --env-file=apps/demo/.env.local --import tsx scripts/model-validate.ts
```

Do not print the environment or key while diagnosing connections. A provider response with `insufficient_quota` / `credit_balance_exhausted` requires account billing attention; repeating the same inference request will not fix it. Such a response does not establish that the selected model is accessible to the account.

The test uses synthetic Chinese inputs and accelerated event timestamps:

1. Ask for multiple replies, a prepared follow-up, and later reconsideration.
2. Follow an unchanged-context branch through delivery-time validation.
3. Return to the same initial model plan and cancel the interview before delivery.
4. Wake the planner without new input before the contact deadline; either silence or speech is allowed, and the report records the actual choice.
5. Pause contact at the deadline, checking that silence preserves the obligation.
6. Restore permission and check renewed contact without a new user message.

Every candidate plan is returned by the model. The runner does not fill missing behavior with the scripted demo planner. It writes a local report under ignored `tmp/model-validation/`, including plans, visible messages, queue states, request counts, latency, and provider-reported token usage where available. Credentials and request headers are not recorded. Reports are not automatically published or added to the paper. They establish integration behavior, not response quality, user benefit, or uninterrupted day-long background execution.

The existing Live demo is browser-driven: it uses the real clock and persists state locally, then coalesces missed wakeups when resumed. It does not run while the page is closed. The local demo API also needs authentication and rate limits before exposure as a public, paid-model service.

## LiteLLM gateway

LiteLLM is useful when a deployment needs centralized routing, aliases, fallbacks, budgets, or provider observability:

```dotenv
LLM_BASE_URL=http://localhost:4000/v1
LLM_API_KEY=your-litellm-key
LLM_MODEL=proactive-planner
LLM_STRUCTURED_OUTPUT=json_object
```

The application does not import the LiteLLM SDK. It talks to the proxy through the same OpenAI-compatible contract, so the simple direct-provider path remains available. See the [LiteLLM proxy documentation](https://docs.litellm.ai/).

## Optional provider request fields

Provider-specific top-level request fields can be supplied as a JSON object:

```dotenv
LLM_ADDITIONAL_BODY={"enable_thinking":false}
```

Reserved transport fields such as `model`, `messages`, `stream`, and `response_format` cannot be overridden through this option.

## Reproducibility checklist

For every reported model experiment, record:

1. provider, region, endpoint protocol, and date;
2. exact model identifier or snapshot;
3. temperature and structured-output mode;
4. system prompt and JSON Schema revision;
5. adapter retry count and transport failures;
6. all deterministic engine policies.
