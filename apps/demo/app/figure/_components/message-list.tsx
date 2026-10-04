import styles from "./figure-theme.module.css";

export type FigureMessage = {
  role: "user" | "assistant";
  label: string;
  at: string;
  content: string;
};

export type FigureAnnotation = {
  kind: "annotation";
  title: string;
  detail: string;
};

export type FigureEntry = FigureMessage | FigureAnnotation;

/** Shared vector-printable chat styling; annotations are not chat messages. */
export function MessageList({ messages }: { messages: readonly FigureEntry[] }) {
  return (
    <div className={styles.messages}>
      {messages.map((entry, index) => {
        if ("kind" in entry) {
          return (
            <aside
              className={styles.annotation}
              data-decision-annotation
              aria-label="Decision annotation, not a chat message"
              key={`annotation-${index}`}
            >
              <strong>{entry.title}</strong>
              <p>{entry.detail}</p>
            </aside>
          );
        }
        return (
          <article
            className={`${styles.message} ${styles[entry.role]}`}
            data-chat-message={entry.role}
            key={`${entry.role}-${entry.at}-${index}`}
          >
            <div className={styles.messageMeta}>
              <strong>{entry.label}</strong>
              <time>{entry.at}</time>
            </div>
            <p>{entry.content}</p>
          </article>
        );
      })}
    </div>
  );
}
