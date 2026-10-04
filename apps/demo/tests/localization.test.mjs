import assert from "node:assert/strict";
import test from "node:test";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { configureBoundedSilence, setProactiveContactAllowed, firePacemaker } from "@proactive-ai/core";
import { formatReason, formatTraceEntry } from "../app/i18n/format.ts";
import { translations } from "../app/i18n/index.ts";
import { createGuidedState, GUIDED_STEP_TIMES, runGuidedStep } from "../app/components/guided-demo.ts";
import { TimelineExperience } from "../app/components/timeline-lab.tsx";

const formatTime = () => "7月31日 09:00:00";
const fixture = (kind, title, detail) => ({ id: "test", at: GUIDED_STEP_TIMES[0], kind, title, detail, triggerId: null });

test("English and Chinese catalogs have identical keys, interpolation signatures, and scenario counts", () => {
  function shape(value) {
    if (typeof value === "function") return `function:${value.length}`;
    if (Array.isArray(value)) return value.map(shape);
    if (value && typeof value === "object") return Object.fromEntries(Object.entries(value).map(([key, item]) => [key, shape(item)]));
    return typeof value;
  }
  assert.deepEqual(shape(translations.zh), shape(translations.en));
  assert.equal(translations.zh.guided.steps.length, GUIDED_STEP_TIMES.length);
});

test("Chinese interface localizes visible labels and accessibility names in both modes", () => {
  for (const mode of ["guided", "model"]) {
    const html = renderToStaticMarkup(createElement(TimelineExperience, {
      mode, language: "zh", setMode() {}, setLanguage() {},
      modelStatus: { configured: false, model: null, protocol: "openai-compatible/chat-completions" },
    }));
    for (const label of ["项目导航", "设计原则", "事件驱动", "可重排队列", "模型无关", "演示", "原理", "记录", "开源项目"]) {
      assert.ok(html.includes(label), label);
    }
    assert.doesNotMatch(html, /hero-orbit|orbit-ring|orbit-pulse/);
    assert.doesNotMatch(html, />(?:NOW|LATER|SILENCE|STREAM|QUEUE|TRACE)<|OPEN SOURCE|01 \/ DEMO|02 \/ SYSTEM|aria-label="(?:Project navigation|Language|Design principles)"/);
    assert.match(html, />PROACTIVE AI</);
  }
});

test("every Chinese guided step presents Chinese trace text and reasons without mutating engine records", async () => {
  let state = createGuidedState();
  for (let step = 0; step < GUIDED_STEP_TIMES.length; step++) {
    state = await runGuidedStep(state, step, "zh");
    const before = structuredClone(state);
    for (const entry of state.log) {
      const view = formatTraceEntry(entry, "zh", formatTime);
      assert.doesNotMatch(`${view.kind}${view.title}${view.detail}`, /[A-Za-z_]/);
      assert.equal(formatTraceEntry(entry, "en", formatTime).title, entry.title);
    }
    for (const action of state.queue) {
      assert.doesNotMatch(formatReason(action.resolutionReason ?? action.reason, "zh"), /[A-Za-z_]/);
    }
    assert.deepEqual(state, before);
  }
});

test("contact-policy changes and failure recovery have Chinese summaries while preserving original errors", async () => {
  let state = createGuidedState();
  state = setProactiveContactAllowed(state, false);
  state = setProactiveContactAllowed(state, true);
  state = configureBoundedSilence(state, null);
  state = configureBoundedSilence(state, 3600);
  for (const entry of state.log) {
    const view = formatTraceEntry(entry, "zh", formatTime);
    assert.doesNotMatch(`${view.title}${view.detail}`, /[A-Za-z]/);
  }
  const failed = await firePacemaker(state, () => { throw new Error("Provider unavailable"); }, state.now);
  const error = failed.state.log.findLast((entry) => entry.kind === "error");
  const view = formatTraceEntry(error, "zh", formatTime);
  assert.match(view.detail, /未发送/);
  assert.equal(view.rawDetail, error.detail);
  assert.equal(formatTraceEntry(error, "en", formatTime).detail, error.detail);
});

test("rescheduling, stale plans, replacements, and completed reconsiderations have localized labels", () => {
  const rescheduled = formatTraceEntry(fixture("queue", "Queued action rescheduled", "send-0001 → 2026-07-31T09:00:00.000Z"), "zh", formatTime);
  assert.equal(rescheduled.detail, "行动 send-0001 的执行时间已改为 7月31日 09:00:00。");
  const stale = formatTraceEntry(fixture("plan", "Stale plan discarded", "The planner observed revision 1, but revision 2 was current before commit. The candidate produced no visible output and will be replanned with the new input."), "zh", formatTime);
  assert.match(stale.detail, /版本 1.*版本 2/);
  assert.doesNotMatch(stale.detail, /[A-Za-z]/);
  for (const [kind, title, detail] of [
    ["queue", "Queued message replaced", "替换为最新的建议。"],
    ["queue", "Reconsideration consumed", "reconsideration_completed"],
  ]) {
    const view = formatTraceEntry(fixture(kind, title, detail), "zh", formatTime);
    assert.notEqual(view.title, title);
    assert.doesNotMatch(view.detail, /[A-Za-z_]/);
  }
});

test("free-form content and unfamiliar diagnostics remain intact, with no invented translation", () => {
  for (const language of ["en", "zh"]) {
    const detail = "A user-specified English phrase, not a system label.";
    assert.equal(formatReason(detail, language), detail);
    assert.equal(formatTraceEntry(fixture("plan", "Unknown future event", detail), language, formatTime).detail, detail);
  }
});
