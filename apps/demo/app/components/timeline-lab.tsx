"use client";

import {
  addSeconds,
  advanceTime,
  ConversationCoordinator,
  createConversationState,
  firePacemaker,
  getNextScheduledEventAt,
  getPendingQueue,
  setProactiveContactAllowed,
  synchronizeWallClock,
  type ConversationState,
  type EngineTransition,
  type Planner,
  type PlannerContext,
  type PlannerOutput,
  type QueueAction,
} from "@proactive-ai/core";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { createGuidedState, GUIDED_PLAYBACK_DELAYS_MS, GUIDED_START, guidedCopy, runGuidedStep } from "./guided-demo";
import { formatReason, formatTraceEntry } from "../i18n/format";
import { translations, uiMessages as copy, type Language } from "../i18n";

type ExperienceMode = "guided" | "model";
type TimeMode = "simulation" | "live";
type NoticeKey = "ready" | "running" | "planned" | "failed" | "liveSynchronized" | "stagedDone" | "timeAdvanced" | "resetDone" | "liveWaiting";

interface ModelStatus {
  configured: boolean;
  model: string | null;
  protocol: string;
}

const DEMO_START = GUIDED_START;
// The former mixed-planner session is intentionally left untouched.
const LIVE_STATE_STORAGE_KEY = "proactive-ai.model-live-state.v2";
const MAX_BROWSER_TIMER_MS = 2_147_000_000;


export function TimelineLab() {
  const [language, setLanguage] = useState<Language>("en");
  const [mode, setMode] = useState<ExperienceMode>("guided");
  const [modelStatus, setModelStatus] = useState<ModelStatus>({
    configured: false, model: null, protocol: "openai-compatible/chat-completions",
  });
  useEffect(() => {
    fetch("/api/plan")
      .then(async (response) => response.json() as Promise<ModelStatus>)
      .then(setModelStatus)
      .catch(() => undefined);
  }, []);
  return <TimelineExperience
    key={mode === "guided" ? `guided-${language}` : "model"}
    mode={mode} setMode={setMode} language={language} setLanguage={setLanguage}
    modelStatus={modelStatus}
  />;
}

export function TimelineExperience({ mode, setMode, language, setLanguage, modelStatus }: {
  mode: ExperienceMode;
  setMode: (mode: ExperienceMode) => void;
  language: Language;
  setLanguage: (language: Language) => void;
  modelStatus: ModelStatus;
}) {
  const guided = mode === "guided";
  const [timeMode, setTimeMode] = useState<TimeMode>(guided ? "simulation" : "live");
  const [state, setState] = useState<ConversationState>(() =>
    guided ? createGuidedState() :
      readStoredLiveState(new Date()) ?? createConversationState({ boundedSilenceSeconds: 14_400 }),
  );
  const [guidedStep, setGuidedStep] = useState(0);
  const [playing, setPlaying] = useState(false);
  const guidedStepRunning = useRef(false);
  const guidedHistory = useRef<ConversationState[]>([]);
  const messageStream = useRef<HTMLDivElement>(null);
  const [draft, setDraft] = useState("");
  const [staged, setStaged] = useState<string[]>([]);
  const [busy, setBusy] = useState(false);
  const [inputPlanning, setInputPlanning] = useState(false);
  const [notice, setNotice] = useState<NoticeKey>("ready");
  const [liveNow, setLiveNow] = useState(state.now);
  const inputCoordinator = useRef<ConversationCoordinator | null>(null);
  const simulationState = useRef(createConversationState({ now: DEMO_START, boundedSilenceSeconds: 14_400 }));
  const liveSyncing = useRef(false);
  const t = copy[language];

  useEffect(() => {
    document.documentElement.lang = language === "zh" ? "zh-CN" : "en";
    document.title = copy[language].pageTitle;
  }, [language]);

  useEffect(() => {
    if (guided) return;
    if (timeMode === "simulation") {
      simulationState.current = state;
      return;
    }
    try { window.localStorage.setItem(LIVE_STATE_STORAGE_KEY, JSON.stringify(state)); } catch { /* Storage may be unavailable in private browsing. */ }
  }, [guided, state, timeMode]);

  useEffect(() => {
    if (timeMode !== "live") return;
    const updateClock = () => setLiveNow(new Date().toISOString());
    updateClock();
    const timer = window.setInterval(updateClock, 1_000);
    return () => window.clearInterval(timer);
  }, [timeMode]);

  const pendingQueue = useMemo(() => getPendingQueue(state), [state]);
  const planner = remotePlanner;
  const canAcceptInput = !busy || inputPlanning;
  const displayNow = timeMode === "live" ? liveNow : state.now;
  const nextScheduledAt = useMemo(
    () => getNextScheduledEventAt(state),
    [state],
  );

  const stepForward = useCallback(async () => {
    if (!guided || guidedStepRunning.current || guidedStep >= guidedCopy[language].length) return;
    guidedStepRunning.current = true;
    setBusy(true);
    try {
      const next = await runGuidedStep(state, guidedStep, language);
      // Keep the entire pre-step snapshot so reviewing a step also restores
      // the queue, clock, policy deadline, and decision trace.
      guidedHistory.current = [...guidedHistory.current.slice(0, guidedStep), structuredClone(state)];
      setState(next);
      setGuidedStep(guidedStep + 1);
      if (guidedStep + 1 === guidedCopy[language].length) setPlaying(false);
    } catch {
      setNotice("failed");
      setPlaying(false);
    } finally {
      guidedStepRunning.current = false;
      setBusy(false);
    }
  }, [guided, guidedStep, language, state]);

  function stepBackward() {
    if (!guided || busy || guidedStepRunning.current || guidedStep === 0) return;
    const previous = guidedHistory.current[guidedStep - 1];
    if (!previous) return;
    setPlaying(false);
    setState(structuredClone(previous));
    setGuidedStep(guidedStep - 1);
    setNotice("ready");
  }

  useEffect(() => {
    if (!guided || !playing || busy) return;
    const delay = GUIDED_PLAYBACK_DELAYS_MS[guidedStep];
    if (delay === undefined) return;
    const timer = window.setTimeout(() => void stepForward(), delay);
    return () => window.clearTimeout(timer);
  }, [busy, guided, guidedStep, playing, stepForward]);

  useEffect(() => {
    const stream = messageStream.current;
    if (stream) stream.scrollTop = stream.scrollHeight;
  }, [state.messages.length]);

  useEffect(() => {
    if (guided || timeMode !== "live" || busy || state.messages.length === 0) return;
    const wakeAtMilliseconds = Date.parse(nextScheduledAt);
    let timer: number | null = null;

    const synchronize = async () => {
      if (liveSyncing.current) return;
      liveSyncing.current = true;
      setBusy(true);
      setNotice("running");
      try {
        const now = wallClockAtOrAfter(state.now);
        const result = await synchronizeWallClock(state, now, planner);
        setLiveNow(now.toISOString());
        setState(result.state);
        setNotice(
          result.transitions.some((item) => item.outcome === "planner_error")
            ? "failed"
            : result.transitions.length > 0
              ? "planned"
              : "liveSynchronized",
        );
      } finally {
        liveSyncing.current = false;
        setBusy(false);
      }
    };

    const schedule = () => {
      const delay = Math.max(0, wakeAtMilliseconds - Date.now());
      timer = window.setTimeout(
        () => void synchronize(),
        Math.min(delay, MAX_BROWSER_TIMER_MS),
      );
    };
    const synchronizeIfDue = () => {
      if (document.visibilityState === "visible" && Date.now() >= wakeAtMilliseconds) {
        if (timer !== null) window.clearTimeout(timer);
        void synchronize();
      }
    };

    schedule();
    window.addEventListener("focus", synchronizeIfDue);
    document.addEventListener("visibilitychange", synchronizeIfDue);
    return () => {
      if (timer !== null) window.clearTimeout(timer);
      window.removeEventListener("focus", synchronizeIfDue);
      document.removeEventListener("visibilitychange", synchronizeIfDue);
    };
  }, [busy, guided, nextScheduledAt, planner, state, timeMode]);

  async function applyUserArrivals(contents: string[]) {
    if (guided || contents.length === 0 || !canAcceptInput) return;
    const coordinator =
      inputCoordinator.current ??
      new ConversationCoordinator(state, planner, { coalesceWindowMs: 350 });
    inputCoordinator.current = coordinator;
    coordinator.setPlanner(planner);
    setInputPlanning(true);
    setBusy(true);
    setNotice("running");
    try {
      const pendingTransitions = contents.map((content) =>
        coordinator.receiveUserMessage(
          content,
          timeMode === "live" ? wallClockAtOrAfter(state.now) : state.now,
        ),
      );
      setState(coordinator.getState());
      const transitions = await Promise.all(pendingTransitions);
      const transition = transitions.at(-1);
      if (transition && inputCoordinator.current === coordinator) {
        commitTransition(transition);
      }
    } finally {
      if (inputCoordinator.current === coordinator) {
        inputCoordinator.current = null;
        setInputPlanning(false);
        setBusy(false);
      }
    }
  }

  function commitTransition(transition: EngineTransition) {
    setState(transition.state);
    setNotice(transition.outcome === "planned" ? "planned" : "failed");
  }

  async function sendComposer() {
    const current = draft.trim();
    const contents = current ? [...staged, current] : staged;
    if (contents.length === 0) return;
    setDraft("");
    setStaged([]);
    await applyUserArrivals(contents);
  }

  function stageMessage() {
    const current = draft.trim();
    if (!current) return;
    setStaged((items) => [...items, current]);
    setDraft("");
    setNotice("stagedDone");
  }

  async function moveClock(seconds: number) {
    if (busy) return;
    setBusy(true);
    setNotice("running");
    try {
      const result = await advanceTime(
        state,
        addSeconds(state.now, seconds),
        planner,
      );
      setState(result.state);
      setNotice(
        result.transitions.some((item) => item.outcome === "planner_error")
          ? "failed"
          : "timeAdvanced",
      );
    } finally {
      setBusy(false);
    }
  }

  async function pulse() {
    if (busy) return;
    setBusy(true);
    setNotice("running");
    try {
      commitTransition(await firePacemaker(state, planner, state.now));
    } finally {
      setBusy(false);
    }
  }

  function reset() {
    if (busy) return;
    if (guided) {
      setPlaying(false);
      guidedHistory.current = [];
      setGuidedStep(0);
      setState(createGuidedState());
      setNotice("ready");
      return;
    }
    inputCoordinator.current = null;
    setInputPlanning(false);
    const now = timeMode === "live" ? new Date() : new Date(DEMO_START);
    if (timeMode === "live") {
      try { window.localStorage.removeItem(LIVE_STATE_STORAGE_KEY); } catch { /* Optional storage. */ }
      setLiveNow(now.toISOString());
    }
    setState(
      createConversationState({
        now,
        boundedSilenceSeconds: 14_400,
      }),
    );
    setDraft("");
    setStaged([]);
    setNotice("resetDone");
  }

  function changeTimeMode(nextMode: TimeMode) {
    if (nextMode === timeMode || busy) return;
    inputCoordinator.current = null;
    setInputPlanning(false);

    if (timeMode === "simulation") simulationState.current = state;
    if (nextMode === "simulation") {
      setState(simulationState.current);
      setTimeMode(nextMode);
      setNotice("ready");
      return;
    }

    const now = new Date();
    const stored = readStoredLiveState(now);
    setState(
      stored ??
        createConversationState({
          now,
          boundedSilenceSeconds: 14_400,
        }),
    );
    setLiveNow(now.toISOString());
    setTimeMode(nextMode);
    setNotice("liveWaiting");
  }

  const scenarios = t.quickScenarios;

  return (
    <main>
      <nav className="topbar" aria-label={t.navigation}>
        <a className="wordmark" href="#top" aria-label={t.home}>
          PROACTIVE AI
        </a>
        <span className="nav-note">{t.navNote}</span>
        <div className="language-switch" aria-label={t.language}>
          <button
            className={language === "en" ? "active" : ""}
            onClick={() => setLanguage("en")}
            type="button"
          >
            {t.languageEnglish}
          </button>
          <button
            className={language === "zh" ? "active" : ""}
            onClick={() => setLanguage("zh")}
            type="button"
          >
            {t.languageChinese}
          </button>
        </div>
      </nav>

      <header className="hero" id="top">
        <div className="hero-copy">
          <p className="eyebrow">{t.heroEyebrow}</p>
          <h1>{t.heroTitle}</h1>
          <p className="hero-body">{t.heroBody}</p>
          <div className="principle-row" aria-label={t.principles}>
            <span>{t.eventDriven}</span>
            <span>{t.replannable}</span>
            <span>{t.providerNeutral}</span>
          </div>
        </div>
      </header>

      <section className="lab-section" aria-labelledby="lab-title" data-experience={mode}>
        <div className="section-heading">
          <div>
            <p className="section-index">01 / {t.demoLabel}</p>
            <h2 id="lab-title">{t.lab}</h2>
            <p>{t.labDescription}</p>
          </div>
          <div className="lab-controls">
            <div className="control-group">
              <span className="control-label">{t.plannerSource}</span>
              <div className="mode-control" aria-label={t.plannerSource}>
                <button
                  className={guided ? "active" : ""}
                  aria-pressed={guided}
                  disabled={busy}
                  onClick={() => setMode("guided")}
                  type="button"
                >
                  <span className="mode-dot" />
                  {t.deterministic}
                </button>
                <button
                  className={mode === "model" ? "active" : ""}
                  aria-pressed={!guided}
                  disabled={busy || !modelStatus.configured}
                  onClick={() => setMode("model")}
                  title={modelStatus.configured ? modelStatus.model ?? "" : t.unavailable}
                  type="button"
                >
                  <span className="mode-dot" />
                  {t.model}
                  {!modelStatus.configured && <small>{t.unavailable}</small>}
                </button>
              </div>
            </div>
          </div>
        </div>

        {guided ? (
          <div className="guided-player" data-guided-step={guidedStep}>
            <div className="guided-heading" aria-live="polite">
              <span className="guided-progress">{guidedStep} / {guidedCopy[language].length}</span>
              <div>
                <span className="guided-time">{guidedStep > 0 ? guidedCopy[language][guidedStep - 1].time : t.demoReady}</span>
                <h3>{guidedStep > 0 ? guidedCopy[language][guidedStep - 1].title : t.demoIntro}</h3>
                <p>{guidedStep > 0 ? guidedCopy[language][guidedStep - 1].detail : t.emptyBody}</p>
              </div>
            </div>
            <div className="guided-actions">
              <button className="button-primary" type="button"
                disabled={guidedStep === guidedCopy[language].length}
                onClick={() => setPlaying(!playing)}>{playing ? t.pause : t.play}</button>
              <button className="button-secondary" type="button" disabled={busy || guidedStep === 0}
                onClick={stepBackward}>{t.previous}</button>
              <button className="button-secondary" type="button" disabled={busy || playing || guidedStep === guidedCopy[language].length}
                onClick={() => void stepForward()}>{t.next}</button>
              <button className="button-secondary" type="button" disabled={busy} onClick={reset}>{t.restart}</button>
            </div>
            <ol className="guided-milestones" aria-label={t.deterministic}>
              {guidedCopy[language].map((step, index) => (
                <li key={step.title} className={index < guidedStep ? "complete" : ""}
                  aria-current={index === guidedStep - 1 ? "step" : undefined}>
                  <span>{index + 1}</span>{step.title}
                </li>
              ))}
            </ol>
            <p className="guided-hint">{t.demoHint}</p>
          </div>
        ) : (
          <div className="live-options">
            <p>{t.liveHint}</p>
            <details className="advanced-controls">
              <summary>{t.advanced}</summary>
              <p>{t.advancedHint}</p>
              <div className="mode-control" aria-label={t.timeSource}>
                <button className={timeMode === "live" ? "active" : ""} aria-pressed={timeMode === "live"}
                  disabled={busy} onClick={() => changeTimeMode("live")} type="button">{t.live}</button>
                <button className={timeMode === "simulation" ? "active" : ""} aria-pressed={timeMode === "simulation"}
                  disabled={busy} onClick={() => changeTimeMode("simulation")} type="button">{t.simulation}</button>
              </div>
              {timeMode === "simulation" && <SimulationTimeControls
                language={language} busy={busy}
                onAdvance={(seconds) => void moveClock(seconds)}
                onPulse={() => void pulse()}
              />}
            </details>
          </div>
        )}

        <div className="lab-shell">
          <section className="conversation-panel" aria-labelledby="conversation-title">
            <div className="panel-header">
              <div>
                <span className="panel-kicker">{t.streamLabel}</span>
                <h3 id="conversation-title">{t.conversation}</h3>
              </div>
              <div className="clock-readout">
                <span>{timeMode === "live" ? t.liveClock : t.virtualClock}</span>
                <strong>{formatClock(displayNow, language, timeMode)}</strong>
              </div>
            </div>

            <div className="message-stream" ref={messageStream} aria-live="polite">
              {state.messages.length === 0 ? (
                <div className="empty-state">
                  <span className="empty-glyph">○</span>
                  <strong>{t.emptyTitle}</strong>
                  <p>{guided ? t.emptyBody : t.liveEmpty}</p>
                </div>
              ) : (
                state.messages.map((message) => (
                  <article
                    className={`message message-${message.role}`}
                    key={message.id}
                  >
                    <div className="message-meta">
                      <span>{message.role === "user" ? (guided ? t.exampleUser : t.user) : t.assistant}</span>
                      <time>{formatClock(message.at, language, timeMode)}</time>
                    </div>
                    <p>{message.content}</p>
                    {!guided && message.reason && <small>{formatReason(message.reason, language)}</small>}
                  </article>
                ))
              )}
            </div>

            {!guided && <><div className="composer">
              <label htmlFor="message-draft">{t.composer}</label>
              {staged.length > 0 && (
                <div className="staged-list">
                  <span className="staged-label">{t.staged}</span>
                  {staged.map((item, index) => (
                    <button
                      key={`${item}-${index}`}
                      onClick={() =>
                        setStaged((items) => items.filter((_, itemIndex) => itemIndex !== index))
                      }
                      title={t.remove}
                      type="button"
                    >
                      <span>{item}</span>
                      <b aria-hidden="true">×</b>
                    </button>
                  ))}
                </div>
              )}
              <textarea
                id="message-draft"
                onChange={(event) => setDraft(event.target.value)}
                onKeyDown={(event) => {
                  if ((event.metaKey || event.ctrlKey) && event.key === "Enter") {
                    void sendComposer();
                  }
                }}
                placeholder={t.placeholder}
                rows={3}
                value={draft}
              />
              <div className="composer-actions">
                <button
                  className="button-secondary"
                  disabled={!draft.trim() || !canAcceptInput}
                  onClick={stageMessage}
                  type="button"
                >
                  + {t.stage}
                </button>
                <button
                  className="button-primary"
                  disabled={
                    (!draft.trim() && staged.length === 0) || !canAcceptInput
                  }
                  onClick={() => void sendComposer()}
                  type="button"
                >
                  {t.send}
                  <ArrowIcon />
                </button>
              </div>
            </div>

            <div className="scenario-row">
              <span>{t.scenarios}</span>
              {scenarios.map((scenario) => (
                <button
                  disabled={!canAcceptInput}
                  key={scenario.label}
                  onClick={() => void applyUserArrivals(scenario.messages)}
                  type="button"
                >
                  {scenario.label}
                </button>
              ))}
            </div></>}
          </section>

          <aside className="timeline-panel" aria-labelledby="queue-title">
            <div className="panel-header timeline-heading">
              <div>
                <span className="panel-kicker">{t.queueLabel}</span>
                <h3 id="queue-title">{t.queue}</h3>
              </div>
              <span className="queue-count">{pendingQueue.length}</span>
            </div>
            <p className="panel-description">{t.queueBody}</p>

            <div className="contact-policy">
              <div>
                <span>{t.boundedSilence}</span>
                <strong>
                  {state.contactPolicy.contactAllowed
                    ? t.contactAllowed
                    : t.contactPaused}
                </strong>
                <small>
                  {t.contactDeadline}: {state.contactPolicy.deadlineAt
                    ? formatClock(state.contactPolicy.deadlineAt, language, timeMode)
                    : "—"}
                </small>
              </div>
              {!guided && <button
                disabled={busy}
                onClick={() =>
                  setState((current) =>
                    setProactiveContactAllowed(
                      current,
                      !current.contactPolicy.contactAllowed,
                    ),
                  )
                }
                type="button"
              >
                {state.contactPolicy.contactAllowed
                  ? t.pauseContact
                  : t.resumeContact}
              </button>}
            </div>

            <div className="queue-line">
              <div className="now-marker">
                <span />
                <strong>{t.now}</strong>
                <time>{formatClock(displayNow, language, timeMode)}</time>
              </div>
              {state.queue.length === 0 ? (
                <p className="queue-empty">{t.noQueue}</p>
              ) : (
                [...state.queue]
                  .sort((left, right) => Date.parse(left.notBefore) - Date.parse(right.notBefore))
                  .map((action) => (
                    <QueueCard
                      action={action}
                      language={language}
                      key={action.id}
                      now={displayNow}
                      timeMode={timeMode}
                    />
                  ))
              )}
            </div>

            {!guided && timeMode === "live" && (
              <div className="live-controls">
                <span className="live-indicator" aria-hidden="true" />
                <div>
                  <strong>{t.liveActive}</strong>
                  <small>
                    {state.messages.length === 0 ? t.awaitingInput : `${t.nextWake}: ${formatClock(nextScheduledAt, language, timeMode)}`}
                  </small>
                </div>
              </div>
            )}
            <div className="timeline-footer">
              <span className={busy ? "notice busy" : "notice"}>{guided && notice !== "failed"
                ? (playing ? t.demoPlaying : guidedStep === guidedCopy[language].length ? t.demoComplete : guidedStep > 0 ? t.demoPaused : t.demoReady)
                : t[notice]}</span>
              {!guided && <button disabled={busy} onClick={reset} type="button">
                {t.reset}
              </button>}
            </div>
          </aside>
        </div>

        <section className="trace-panel" aria-labelledby="trace-title">
          <div className="trace-heading">
            <div>
              <span className="panel-kicker">{t.traceLabel}</span>
              <h3 id="trace-title">{t.activity}</h3>
            </div>
            <p>{t.activityBody}</p>
          </div>
          <div className="trace-list" role="region" aria-label={t.activity} tabIndex={0}>
            {state.log.length === 0 ? (
              <p className="trace-empty">{t.noActivity}</p>
            ) : (
              [...state.log]
                .reverse()
                .slice(0, 10)
                .map((entry) => {
                  const display = formatTraceEntry(entry, language, (value) => formatClock(value, language, timeMode));
                  return (
                    <article key={entry.id}>
                      <time>{formatClock(entry.at, language, timeMode)}</time>
                      <span className={`trace-kind trace-${entry.kind}`}>{display.kind}</span>
                      <div>
                        <strong>{display.title}</strong>
                        <p>{display.detail}</p>
                        {display.rawDetail && <details className="trace-error-details">
                          <summary>{t.rawError}</summary>
                          <p>{display.rawDetail}</p>
                        </details>}
                      </div>
                    </article>
                  );
                })
            )}
          </div>
        </section>
      </section>

      <section className="protocol-section" id="protocol" aria-labelledby="protocol-title">
        <div className="protocol-heading">
          <p className="section-index">02 / {t.systemLabel}</p>
          <h2 id="protocol-title">{t.mechanism}</h2>
        </div>
        <div className="protocol-grid">
          {[
            ["01", t.step1Title, t.step1Body],
            ["02", t.step2Title, t.step2Body],
            ["03", t.step3Title, t.step3Body],
          ].map(([number, title, body]) => (
            <article key={number}>
              <span>{number}</span>
              <h3>{title}</h3>
              <p>{body}</p>
            </article>
          ))}
        </div>
      </section>

      <footer>
        <span className="wordmark">PROACTIVE AI</span>
        <p>{t.footer}</p>
        <span>{t.openSource} · 2026</span>
      </footer>
    </main>
  );
}

function QueueCard({
  action,
  language,
  now,
  timeMode,
}: {
  action: QueueAction;
  language: Language;
  now: string;
  timeMode: TimeMode;
}) {
  const t = copy[language];
  const statusLabel = t[action.status];
  return (
    <article className={`queue-card queue-${action.status}`}>
      <span className="queue-node" />
      <div className="queue-card-top">
        <b>{action.type === "send_message" ? t.actionSend : t.actionWake}</b>
        <span>{statusLabel}</span>
      </div>
      <time>{formatClock(action.notBefore, language, timeMode)}</time>
      {action.status === "pending" && (
        <small>
          {t.dueIn} {formatDuration(Date.parse(action.notBefore) - Date.parse(now), language)}
        </small>
      )}
      {action.content && <p>“{action.content}”</p>}
      <details>
        <summary>{t.reason}</summary>
        <p>{formatReason(action.resolutionReason ?? action.reason, language)}</p>
      </details>
    </article>
  );
}

const remotePlanner: Planner = async (context: PlannerContext) => {
  const response = await fetch("/api/plan", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(context),
  });
  const payload = (await response.json()) as {
    plan?: PlannerOutput;
    error?: string;
  };
  if (!response.ok || !payload.plan) {
    throw new Error(payload.error ?? `Model planner failed with HTTP ${response.status}`);
  }
  return payload.plan;
};

function formatClock(
  value: string,
  language: Language,
  timeMode: TimeMode,
): string {
  return new Intl.DateTimeFormat(language === "zh" ? "zh-CN" : "en-GB", {
    month: "short",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hour12: false,
    ...(timeMode === "simulation" ? { timeZone: "UTC" } : {}),
  }).format(new Date(value));
}

function wallClockAtOrAfter(stateNow: string): Date {
  return new Date(Math.max(Date.now(), Date.parse(stateNow)));
}

function readStoredLiveState(now: Date): ConversationState | null {
  try {
    const raw = window.localStorage.getItem(LIVE_STATE_STORAGE_KEY);
    if (!raw) return null;
    const value: unknown = JSON.parse(raw);
    if (!isConversationState(value)) return null;
    if (Date.parse(value.now) > now.getTime()) return null;
    return value;
  } catch {
    return null;
  }
}

function isConversationState(value: unknown): value is ConversationState {
  if (!value || typeof value !== "object") return false;
  const state = value as ConversationState;
  return (
    state.schemaVersion === "1" &&
    Number.isFinite(Date.parse(state.now)) &&
    Number.isInteger(state.revision) &&
    Number.isInteger(state.sequence) &&
    Array.isArray(state.messages) &&
    Array.isArray(state.queue) &&
    Array.isArray(state.log) &&
    typeof state.pacemaker === "object" &&
    state.pacemaker !== null &&
    Number.isFinite(Date.parse(state.pacemaker.nextAt)) &&
    typeof state.contactPolicy === "object" &&
    state.contactPolicy !== null
  );
}

function formatDuration(milliseconds: number, language: Language): string {
  const seconds = Math.max(0, Math.round(milliseconds / 1_000));
  const units = translations[language].duration;
  if (seconds < 60) return units.seconds(seconds);
  const minutes = Math.round(seconds / 60);
  if (minutes < 60) return units.minutes(minutes);
  const hours = Math.round(minutes / 60);
  return units.hours(hours);
}

export function SimulationTimeControls({ language, busy, onAdvance, onPulse }: {
  language: Language;
  busy: boolean;
  onAdvance: (seconds: number) => void;
  onPulse: () => void;
}) {
  const t = copy[language];
  return (
    <div className="time-controls">
      <div className="time-control-group" role="group" aria-label={t.advanceClock}>
        <span className="time-control-label">{t.advanceClock}</span>
        <div className="time-control-buttons">
          {[[20, t.advance20], [1_800, t.advance30], [7_200, t.advance2h], [14_400, t.advance4h]].map(([seconds, label]) => (
            <button key={seconds} disabled={busy} onClick={() => onAdvance(Number(seconds))} type="button">{label}</button>
          ))}
        </div>
      </div>
      <div className="time-control-group" role="group" aria-label={t.manualDecision}>
        <span className="time-control-label">{t.manualDecision}</span>
        <button className="pulse-button" disabled={busy} onClick={onPulse} type="button"><PulseIcon />{t.pulse}</button>
      </div>
    </div>
  );
}

function ArrowIcon() {
  return (
    <svg aria-hidden="true" viewBox="0 0 16 16">
      <path d="M2 8h11M9 3l5 5-5 5" />
    </svg>
  );
}

function PulseIcon() {
  return (
    <svg aria-hidden="true" width="17" height="17" viewBox="0 0 20 20"
      fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
      <path d="M1 10h4l2-6 4 12 2-6h6" />
    </svg>
  );
}
