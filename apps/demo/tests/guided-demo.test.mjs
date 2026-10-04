import assert from "node:assert/strict";
import test from "node:test";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { getPendingQueue } from "@proactive-ai/core";
import { createGuidedState, guidedCopy, GUIDED_PLAYBACK_DELAYS_MS, GUIDED_STEP_TIMES, runGuidedStep } from "../app/components/guided-demo.ts";
import { SimulationTimeControls, TimelineExperience } from "../app/components/timeline-lab.tsx";

test("guided playback takes about ten seconds and holds the final frame", () => {
  assert.deepEqual(GUIDED_PLAYBACK_DELAYS_MS, [200, 2_000, 2_000, 3_000, 2_000]);
  assert.equal(GUIDED_PLAYBACK_DELAYS_MS.length, GUIDED_STEP_TIMES.length);
  assert.equal(GUIDED_PLAYBACK_DELAYS_MS.reduce((sum, delay) => sum + delay, 0), 9_200);
  assert.equal(GUIDED_PLAYBACK_DELAYS_MS[GUIDED_STEP_TIMES.length], undefined);
});

for (const language of ["en", "zh"]) {
  test(`simulation ${language} controls separate time advancement from a bounded line icon`, () => {
    const props = { language, busy: false, onAdvance() {}, onPulse() {} };
    const html = renderToStaticMarkup(createElement(SimulationTimeControls, props));
    assert.equal((html.match(/role="group"/g) ?? []).length, 2);
    assert.equal((html.match(/<button\b/g) ?? []).length, 5);
    const advanceGroup = html.split('class="time-control-buttons"')[1]?.split('</div>')[0];
    assert.equal((advanceGroup.match(/<button\b/g) ?? []).length, 4);
    assert.match(html, /class="pulse-button"/);
    assert.match(html, /<svg[^>]*width="17"[^>]*height="17"[^>]*fill="none"[^>]*stroke="currentColor"/);
    assert.ok(html.includes(language === "zh" ? "推进模拟时间" : "Advance simulated time"));
    assert.ok(html.includes(language === "zh" ? "立即起搏" : "Pulse now"));
    const busyHtml = renderToStaticMarkup(createElement(SimulationTimeControls, { ...props, busy: true }));
    assert.equal((busyHtml.match(/disabled=""/g) ?? []).length, 5);
  });

  test(`guided ${language} story executes the real engine without any API calls`, async (t) => {
    t.mock.method(globalThis, "fetch", () => { throw new Error("Guided demo must not access a provider"); });
    const original = createGuidedState();
    let state = await runGuidedStep(original, 0, language);
    assert.equal(original.messages.length, 0);
    assert.equal(state.messages.length, 3);
    assert.equal(state.messages[0].role, "user");
    assert.equal(state.messages[1].role, "user");
    assert.notEqual(state.messages[0].id, state.messages[1].id);
    assert.equal(state.messages[0].triggerId, state.messages[1].triggerId);
    assert.equal(getPendingQueue(state).length, 3);
    const prepared = state.queue.find((item) => item.reason === "interview_preparation").content;
    const stableIds = state.queue.map((item) => item.id);

    state = await runGuidedStep(state, 1, language);
    assert.equal(state.messages.length, 4);
    assert.equal(state.queue[0].status, "delivered");
    assert.equal(state.messages.at(-1).at, GUIDED_STEP_TIMES[1]);
    assert.equal(getPendingQueue(state).length, 2);

    state = await runGuidedStep(state, 2, language);
    assert.equal(state.messages.length, 6);
    assert.deepEqual(state.queue.map((item) => item.status), ["delivered", "cancelled", "cancelled"]);
    assert.deepEqual(state.queue.map((item) => item.id), stableIds);
    const messagesBeforeSilence = structuredClone(state.messages);
    const deadline = state.contactPolicy.deadlineAt;
    assert.equal(deadline, GUIDED_STEP_TIMES[4]);

    state = await runGuidedStep(state, 3, language);
    assert.deepEqual(state.messages, messagesBeforeSilence);
    assert.equal(state.contactPolicy.deadlineAt, deadline);
    assert.ok(state.log.some((item) => item.kind === "silence"));

    state = await runGuidedStep(state, 4, language);
    assert.equal(state.messages.length, 7);
    assert.equal(state.messages.at(-1).role, "assistant");
    assert.equal(state.messages.at(-1).at, GUIDED_STEP_TIMES[4]);
    assert.equal(state.messages.filter((item) => item.role === "user").length, 3);
    assert.ok(!state.messages.some((item) => item.content === prepared));
    assert.equal(getPendingQueue(state).length, 0);
    assert.ok(Date.parse(state.contactPolicy.deadlineAt) > Date.parse(deadline));
    assert.ok(!state.log.some((item) => item.kind === "error"));
    assert.equal(globalThis.fetch.mock.callCount(), 0);
    assert.deepEqual(await replay(language), state);
  });

  test(`guided ${language} snapshots can be revisited and replayed without changing history`, async (t) => {
    t.mock.method(globalThis, "fetch", () => { throw new Error("Reviewing the demo must not call a provider"); });
    const snapshots = [createGuidedState()];
    for (let step = 0; step < GUIDED_STEP_TIMES.length; step++) {
      snapshots.push(await runGuidedStep(snapshots.at(-1), step, language));
    }
    const original = structuredClone(snapshots);
    for (let step = GUIDED_STEP_TIMES.length - 1; step >= 0; step--) {
      const restored = structuredClone(snapshots[step]);
      assert.deepEqual(await runGuidedStep(restored, step, language), snapshots[step + 1]);
      assert.deepEqual(restored, snapshots[step]);
    }
    // Rewinding past cancellation restores pending intentions, not just text.
    assert.equal(getPendingQueue(snapshots[2]).length, 2);
    assert.equal(getPendingQueue(snapshots[3]).length, 0);
    assert.equal(snapshots[4].messages.length, 6);
    assert.equal(snapshots[5].messages.length, 7);
    assert.deepEqual(snapshots, original);
    assert.equal(globalThis.fetch.mock.callCount(), 0);
  });

  test(`only real-model ${language} experience renders the composer and advanced clock controls`, () => {
    const props = {
      language, setLanguage() {}, setMode() {},
      modelStatus: { configured: true, model: "test-model", protocol: "openai-compatible/chat-completions" },
    };
    const guided = renderToStaticMarkup(createElement(TimelineExperience, { ...props, mode: "guided" }));
    assert.match(guided, /data-guided-step="0"/);
    assert.match(guided, new RegExp(`<button[^>]*disabled=""[^>]*>${language === "zh" ? "上一步" : "Previous step"}</button>`));
    assert.doesNotMatch(guided, /<textarea|class="advanced-controls"/);
    for (const step of guidedCopy[language]) assert.ok(guided.includes(step.title));

    const live = renderToStaticMarkup(createElement(TimelineExperience, { ...props, mode: "model" }));
    assert.match(live, /<textarea[^>]*id="message-draft"/);
    assert.match(live, /<details class="advanced-controls">/);
    assert.match(live, /class="live-controls"/);
    assert.doesNotMatch(live, /data-guided-step|<details[^>]* open/);
    assert.match(live, /API/);
    for (const html of [guided, live]) {
      const traceAt = html.indexOf('<section class="trace-panel"');
      const protocolAt = html.indexOf('<section class="protocol-section"');
      assert.ok(traceAt > html.indexOf('class="lab-shell"') && traceAt < protocolAt);
      // Trace closes inside the lab, before the standalone static explanation.
      assert.match(html.slice(traceAt, protocolAt), /<\/section><\/section>$/);
      assert.match(html, /class="trace-list" role="region"[^>]*tabindex="0"/);
    }
  });
}

test("guided story rejects invalid, skipped, and repeated steps", async () => {
  const initial = createGuidedState();
  await assert.rejects(runGuidedStep(initial, -1, "en"));
  await assert.rejects(runGuidedStep(initial, 5, "en"));
  await assert.rejects(runGuidedStep(initial, 1, "en"));
  await assert.rejects(runGuidedStep(initial, 2, "en"));
  const first = await runGuidedStep(initial, 0, "en");
  await assert.rejects(runGuidedStep(first, 0, "en"));
});

async function replay(language) {
  let state = createGuidedState();
  for (let step = 0; step < GUIDED_STEP_TIMES.length; step++) state = await runGuidedStep(state, step, language);
  return state;
}
