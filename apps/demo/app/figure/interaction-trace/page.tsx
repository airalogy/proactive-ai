import type { ReactNode } from "react";

import { MessageList, type FigureEntry } from "../_components/message-list";
import theme from "../_components/figure-theme.module.css";
import styles from "./interaction-trace.module.css";

const initialMessages = [
  { role: "user", label: "You", at: "09:00", content: "I have an important interview tomorrow." },
  { role: "user", label: "You", at: "09:00", content: "I’m nervous—I haven’t started preparing." },
  { role: "assistant", label: "Proactive AI", at: "09:02", content: "That sounds stressful." },
  { role: "assistant", label: "Proactive AI", at: "09:02", content: "Want to start with the first minute of your introduction?" },
] as const;

const updateMessages = [
  { role: "user", label: "You", at: "16:30", content: "The interview was cancelled. I don’t really want to think about it tonight." },
  { role: "assistant", label: "Proactive AI", at: "16:31", content: "I’m sorry—that’s frustrating. We can leave it there for tonight." },
] as const;

const previousExchange = [
  { ...updateMessages[0], at: "Mon 16:30" },
  { ...updateMessages[1], at: "Mon 16:31" },
] as const;

const silenceMessages = [
  ...previousExchange,
  { kind: "annotation", title: "Mon 20:00", detail: "No new user input. No message sent." },
] satisfies readonly FigureEntry[];

const resumedMessages = [
  previousExchange[1],
  { kind: "annotation", title: "Two days later", detail: "No new user input." },
  {
    role: "assistant", label: "Proactive AI", at: "Wed 10:00",
    content: "How have the last couple of days been? If you'd like, we can talk about what comes next.",
  },
] satisfies readonly FigureEntry[];

const futureActions = [
  {
    type: "Send",
    timing: "Mon 18:00",
    content: "“What three things should the interviewer remember about you?”",
  },
  {
    type: "Reconsider",
    timing: "Tue 08:00",
    content: "Reload the latest context and decide whether to check in.",
  },
] as const;

function QueueCard({ type, timing, content, status }: {
  type: "Send" | "Reconsider";
  timing: string;
  content: string;
  status: "Pending" | "Cancelled";
}) {
  return (
    <article className={`${styles.queueCard} ${status === "Cancelled" ? styles.cancelledCard : ""}`}>
      <div className={styles.queueHeader}>
        <span className={styles.actionType}>{type}</span>
        <span className={status === "Pending" ? styles.pending : styles.cancelled}>{status}</span>
      </div>
      <strong className={styles.timing}>{timing}</strong>
      <p>{content}</p>
    </article>
  );
}

function ScenarioPanel({ label, title, time, children }: {
  label: string;
  title: string;
  time: string;
  children: ReactNode;
}) {
  return (
    <section className={styles.panel} data-trace-panel={label}>
      <header className={styles.panelHeader}>
        <div>
          <span className={styles.panelLabel}>{label}</span>
          <h1>{title}</h1>
        </div>
        <time>{time}</time>
      </header>
      {children}
    </section>
  );
}

export default function InteractionTraceFigure() {
  return (
    <main className={styles.screen}>
      <div className={`${theme.palette} ${styles.figure}`} data-paper-figure="interaction-trace">
        <div className={styles.topRow}>
          <ScenarioPanel label="a" title="Initial temporal plan" time="Mon 09:02">
            <div className={styles.splitPanel}>
              <section className={styles.conversation}>
                <div className={styles.sectionTitle}>
                  <span>Visible conversation</span>
                  <small>two independent inputs, one decision</small>
                </div>
                <MessageList messages={initialMessages} />
              </section>
              <aside className={styles.queue}>
                <div className={styles.sectionTitle}>
                  <span>Future actions</span>
                  <small>rechecked before execution</small>
                </div>
                {futureActions.map((action) => (
                  <QueueCard key={action.type} {...action} status="Pending" />
                ))}
              </aside>
            </div>
          </ScenarioPanel>

          <ScenarioPanel label="b" title="Context update and replanning" time="Mon 16:31">
            <div className={styles.splitPanel}>
              <section className={styles.conversation}>
                <div className={styles.sectionTitle}>
                  <span>New context</span>
                  <small>arrives before either action executes</small>
                </div>
                <MessageList messages={updateMessages} />
                <div className={styles.replanNote}>
                  <span>Replanned</span>
                  The visible reply follows the new context; both unsent actions are removed.
                </div>
              </section>
              <aside className={styles.queue}>
                <div className={styles.sectionTitle}>
                  <span>Updated queue</span>
                  <small>obsolete plans removed</small>
                </div>
                {futureActions.map((action) => (
                  <QueueCard key={action.type} {...action} status="Cancelled" />
                ))}
              </aside>
            </div>
          </ScenarioPanel>
        </div>

        <div className={styles.bottomRow}>
          <ScenarioPanel label="c" title="Pacemaker respects a request for space" time="Mon 20:00">
            <div className={styles.splitPanel}>
              <section className={styles.conversation}>
                <div className={styles.sectionTitle}>
                  <span>Visible conversation</span>
                  <small>unchanged since panel b</small>
                </div>
                <MessageList messages={silenceMessages} />
              </section>
              <aside className={styles.decisionFlow}>
                <div className={styles.sectionTitle}>
                  <span>Decision at wakeup</span>
                </div>
                <div className={styles.decisionStep}>
                  <strong>Dialogue pacemaker</strong>
                  <small>A new decision without new user input.</small>
                </div>
                <span className={styles.arrow} aria-hidden="true">↓</span>
                <div className={styles.contextStep}>
                  <strong>Latest context</strong>
                  <small>The user asked not to discuss it tonight.</small>
                </div>
                <span className={styles.arrow} aria-hidden="true">↓</span>
                <div className={`${styles.outcomeCard} ${styles.silenceOutcome}`}>
                  <span>Decision</span>
                  <strong>Remain silent</strong>
                  <small>0 new messages</small>
                </div>
              </aside>
            </div>
          </ScenarioPanel>

          <ScenarioPanel label="d" title="Pacemaker reopens the conversation" time="Wed 10:00">
            <div className={styles.splitPanel}>
              <section className={styles.conversation}>
                <div className={styles.sectionTitle}>
                  <span>Visible conversation</span>
                  <small>last reply, then new contact</small>
                </div>
                <MessageList messages={resumedMessages} />
              </section>
              <aside className={styles.decisionFlow}>
                <div className={styles.sectionTitle}>
                  <span>Decision at wakeup</span>
                </div>
                <div className={styles.decisionStep}>
                  <strong>Dialogue pacemaker</strong>
                  <small>A later decision without new user input.</small>
                </div>
                <span className={styles.arrow} aria-hidden="true">↓</span>
                <div className={styles.contextStep}>
                  <strong>Latest context</strong>
                  <small>The pause was for Monday evening. The contact deadline is now due.</small>
                </div>
                <span className={styles.arrow} aria-hidden="true">↓</span>
                <div className={`${styles.outcomeCard} ${styles.contactOutcome}`}>
                  <span>Decision</span>
                  <strong>Reopen conversation</strong>
                  <small>1 new message</small>
                </div>
              </aside>
            </div>
          </ScenarioPanel>
        </div>
      </div>
    </main>
  );
}
