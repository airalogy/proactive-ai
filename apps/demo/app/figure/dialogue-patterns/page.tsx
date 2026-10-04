import { MessageList } from "../_components/message-list";
import theme from "../_components/figure-theme.module.css";
import { dialogueExamples } from "./examples";
import styles from "./dialogue-patterns.module.css";

export default function DialoguePatternsFigure() {
  return (
    <main className={styles.screen}>
      <div className={`${theme.palette} ${styles.figure}`} data-paper-figure="dialogue-patterns">
        {dialogueExamples.map((example) => (
          <section className={styles.panel} data-dialogue-example={example.label} key={example.label}>
            <header className={styles.panelHeader}>
              <span>{example.label}</span>
              <h1>{example.title}</h1>
            </header>
            <div className={styles.conversation}>
              <MessageList messages={example.messages} />
            </div>
            <p className={styles.takeaway}>{example.takeaway}</p>
          </section>
        ))}
      </div>
    </main>
  );
}
