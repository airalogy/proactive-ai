import type { FigureEntry } from "../_components/message-list";

type DialogueExample = {
  label: string;
  title: string;
  messages: readonly FigureEntry[];
  takeaway: string;
};

// Illustrative dialogue, not a recorded model run. Edit content here; keep
// shared presentation in MessageList and the figure's scoped stylesheet.
export const dialogueExamples: readonly DialogueExample[] = [
  {
    label: "a",
    title: "Message bursts and grouped replies",
    messages: [
      { role: "user", label: "You", at: "09:00", content: "I'm giving a speech at my sister's wedding." },
      { role: "user", label: "You", at: "09:00", content: "It needs to be under three minutes." },
      { role: "user", label: "You", at: "09:01", content: "I have so many stories. I don't know where to start." },
      { role: "assistant", label: "AI", at: "09:02", content: "For three minutes, I'd start with just one story." },
      { role: "assistant", label: "AI", at: "09:02", content: "Which memory of her always makes you smile?" },
    ],
    takeaway: "Several messages express one concern; the replies address them together.",
  },
  {
    label: "b",
    title: "Deliberately deferring a reply",
    messages: [
      { role: "user", label: "You", at: "14:00", content: "I'm stuck on this homework question." },
      { role: "user", label: "You", at: "14:00", content: "Let me try a little longer. No hints yet." },
      { kind: "annotation", title: "20-minute pause", detail: "Input observed at 14:00; the AI chooses to wait and reconsider at 14:20. No new input arrives." },
      { role: "assistant", label: "AI", at: "14:20", content: "Would you like a small hint now, or a bit more time?" },
    ],
    takeaway: "The first reply is decided later, not written now and merely displayed later.",
  },
  {
    label: "c",
    title: "Returning to an earlier topic",
    messages: [
      { role: "user", label: "You", at: "Tue 19:00", content: "I'm not sure what to get my dad for his birthday." },
      { role: "assistant", label: "AI", at: "Tue 19:01", content: "What does he enjoy doing?" },
      { role: "user", label: "You", at: "Tue 19:02", content: "He loves cooking. I'll look for something tomorrow." },
      { kind: "annotation", title: "The next day", detail: "No new user input; no update on the gift choice." },
      { role: "assistant", label: "AI", at: "Wed 17:30", content: "Did you find a birthday gift for your dad, or are you still looking?" },
    ],
    takeaway: "A follow-up reconnects to a specific unresolved topic in the shared history.",
  },
  {
    label: "d",
    title: "Reopening a concluded exchange",
    messages: [
      { role: "user", label: "You", at: "Mon 21:00", content: "Let's leave it there for today. Bye!" },
      { role: "assistant", label: "AI", at: "Mon 21:00", content: "Okay, bye!" },
      { kind: "annotation", title: "Two days later", detail: "No new input or agreed follow-up. A dialogue pacemaker opens a new decision opportunity." },
      { role: "assistant", label: "AI", at: "Wed 19:30", content: "Hey, how has your week been going?" },
    ],
    takeaway: "The AI initiates a fresh exchange after both sides have said goodbye.",
  },
];
