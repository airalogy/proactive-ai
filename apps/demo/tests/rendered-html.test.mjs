import assert from "node:assert/strict";
import test from "node:test";

async function render(pathname = "/") {
  const workerUrl = new URL("../dist/server/index.js", import.meta.url);
  workerUrl.searchParams.set("test", `${process.pid}-${Date.now()}`);
  const { default: worker } = await import(workerUrl.href);

  return worker.fetch(
    new Request(`http://localhost${pathname}`, {
      headers: { accept: "text/html" },
    }),
    {
      ASSETS: {
        fetch: async () => new Response("Not found", { status: 404 }),
      },
    },
    {
      waitUntil() {},
      passThroughOnException() {},
    },
  );
}

test("server-renders the completed research demo", async () => {
  const response = await render();
  assert.equal(response.status, 200);
  assert.match(response.headers.get("content-type") ?? "", /^text\/html\b/i);

  const html = await response.text();
  assert.match(html, /<title>Proactive AI — From turns to timelines<\/title>/i);
  assert.match(html, /Conversation should have a future/);
  assert.match(html, /class="hero-body"/);
  assert.match(html, /class="principle-row"/);
  assert.doesNotMatch(html, /hero-orbit|orbit-ring|orbit-pulse/);
  assert.match(html, /Timeline lab/);
  assert.match(html, /Guided demo/);
  assert.match(html, /Live chat/);
  assert.match(html, /Next step/);
  assert.match(html, /Previous step/);
  assert.match(html, /Start over/);
  assert.match(html, /data-guided-step="0"/);
  assert.doesNotMatch(html, /<textarea|id="message-draft"|Quick scenarios|Time source/);
  assert.match(html, /Future queue/);
  assert.ok(html.indexOf('id="queue-title"') < html.indexOf('id="trace-title"'));
  assert.ok(html.indexOf('id="trace-title"') < html.indexOf('id="protocol-title"'));
  assert.match(html, /<h3 id="trace-title">Decision trace<\/h3>/);
  assert.doesNotMatch(html, /class="trace-section"|03 \/ TRACE/);
  assert.match(html, /The protocol/);
  assert.match(html, /<a\b[^>]*class="wordmark"[^>]*>PROACTIVE AI<\/a>/);
  assert.match(html, /<footer><span class="wordmark">PROACTIVE AI<\/span>/);
  assert.doesNotMatch(html, /wordmark-mark|favicon\.svg/);
  assert.doesNotMatch(html, /codex-preview|react-loading-skeleton|Starter Project/i);
  assert.doesNotMatch(html, /href="\/figure\//);
});

test("server-renders four supplementary dialogues with separate decision annotations", async () => {
  const response = await render("/figure/dialogue-patterns");
  assert.equal(response.status, 200);
  const html = await response.text();
  assert.match(html, /data-paper-figure="dialogue-patterns"/);
  assert.deepEqual(
    [...html.matchAll(/<section\b[^>]*data-dialogue-example="([a-d])"/g)].map((match) => match[1]),
    ["a", "b", "c", "d"],
  );
  assert.equal([...html.matchAll(/<article\b[^>]*data-chat-message="(?:user|assistant)"/g)].length, 15);
  assert.equal([...html.matchAll(/<aside\b[^>]*data-decision-annotation/g)].length, 3);
  for (const title of [
    "Message bursts and grouped replies", "Deliberately deferring a reply",
    "Returning to an earlier topic", "Reopening a concluded exchange",
  ]) assert.ok(html.includes(title));
  assert.match(html, /Input observed at 14:00/);
  assert.match(html, /Wed 19:30/);
  assert.match(html, /A dialogue pacemaker opens a new decision opportunity/);
  assert.doesNotMatch(html, /Timeline lab|Planner mode|Export vector PDF|Future actions/);
});

test("model status endpoint fails closed when credentials are absent", async () => {
  const workerUrl = new URL("../dist/server/index.js", import.meta.url);
  workerUrl.searchParams.set("test", `${process.pid}-${Date.now()}-api`);
  const { default: worker } = await import(workerUrl.href);
  const response = await worker.fetch(
    new Request("http://localhost/api/plan", { headers: { accept: "application/json" } }),
    { ASSETS: { fetch: async () => new Response("Not found", { status: 404 }) } },
    { waitUntil() {}, passThroughOnException() {} },
  );

  assert.equal(response.status, 200);
  const payload = await response.json();
  assert.equal(payload.configured, false);
  assert.equal(payload.protocol, "openai-compatible/chat-completions");
});

test("server-renders the paper interaction trace without demo chrome", async () => {
  const response = await render("/figure/interaction-trace");
  assert.equal(response.status, 200);

  const html = await response.text();
  assert.match(html, /Initial temporal plan/);
  assert.match(html, /Context update and replanning/);
  assert.match(html, /Pacemaker respects a request for space/);
  assert.match(html, /Pacemaker reopens the conversation/);
  assert.match(html, /How have the last couple of days been/);
  const silencePanel = html.split('data-trace-panel="c"')[1]?.split('data-trace-panel="d"')[0];
  const contactPanel = html.split('data-trace-panel="d"')[1];
  assert.ok(silencePanel);
  assert.ok(contactPanel);
  assert.equal((silencePanel.match(/<article\b[^>]*data-chat-message=/g) ?? []).length, 2);
  assert.match(silencePanel, /unchanged since panel b/);
  assert.match(silencePanel, /Mon 16:30/);
  assert.match(silencePanel, /Mon 16:31/);
  assert.match(silencePanel, /No new user input\. No message sent\./);
  assert.match(silencePanel, /0 new messages/);
  assert.doesNotMatch(silencePanel, /How have the last couple of days been/);
  assert.equal((contactPanel.match(/<article\b[^>]*data-chat-message="assistant"/g) ?? []).length, 2);
  assert.doesNotMatch(contactPanel, /<article\b[^>]*data-chat-message="user"/);
  assert.match(contactPanel, /Two days later/);
  assert.match(contactPanel, /Wed 10:00/);
  assert.match(contactPanel, /1 new message/);
  assert.equal(
    (html.match(/<p>“What three things should the interviewer remember about you\?”<\/p>/g) ?? []).length,
    2,
  );
  assert.doesNotMatch(html, /Suggest three points the interviewer should remember/);
  assert.doesNotMatch(
    html,
    /Timeline lab|Planner mode|Write one message|Export vector PDF|Back to demo/,
  );
});
