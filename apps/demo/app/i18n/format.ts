import type { EngineLogEntry } from "@proactive-ai/core";
import { translations, type Language } from "./index";

function lookup(messages: Record<string, string>, key: string): string {
  return Object.prototype.hasOwnProperty.call(messages, key) ? messages[key] : key;
}

// Localize presentation only: stored engine records and free-form model/user
// content retain their original meaning and are never rewritten in place.
export function formatReason(reason: string, language: Language): string {
  return lookup(translations[language].trace.reasons, reason);
}

export function formatTraceEntry(
  entry: EngineLogEntry,
  language: Language,
  formatTime: (value: string) => string,
): { kind: string; title: string; detail: string; rawDetail?: string } {
  const text = translations[language].trace;
  const result = {
    kind: text.kinds[entry.kind],
    title: lookup(text.titles, entry.title),
    detail: formatReason(entry.detail, language),
  };

  if (entry.title === "Message scheduled" || entry.title === "Reconsideration scheduled") {
    const match = entry.detail.match(/^([\s\S]*) · (\d{4}-\d{2}-\d{2}T[^ ]+Z)$/);
    if (match && Number.isFinite(Date.parse(match[2]))) {
      result.detail = `${formatReason(match[1], language)} · ${formatTime(match[2])}`;
    }
  }
  if (language === "en") return result;

  if (entry.kind === "trigger") {
    const arrivals = entry.detail.match(/^(\d+) new message\(s\); (\d+) due action\(s\)$/);
    const due = entry.detail.match(/^(\d+) due action\(s\)$/);
    if (arrivals) result.detail = text.userTrigger(arrivals[1], arrivals[2]);
    else if (due) result.detail = text.dueTrigger(due[1]);
  }
  if (entry.title === "Queued action rescheduled") {
    const match = entry.detail.match(/^(\S+) → (\d{4}-\d{2}-\d{2}T[^ ]+Z)$/);
    if (match && Number.isFinite(Date.parse(match[2]))) result.detail = text.rescheduled(match[1], formatTime(match[2]));
  }
  if (entry.title === "Stale plan discarded") {
    const match = entry.detail.match(/^The planner observed revision (\d+), but revision (\d+) was current before commit\./);
    if (match) result.detail = text.stalePlan(match[1], match[2]);
  }
  if (entry.kind === "policy") {
    result.detail = lookup(text.policyDetails, entry.detail);
    const match = entry.detail.match(/^The next contact deadline is (\d{4}-\d{2}-\d{2}T[^ ]+Z)\.$/);
    if (match && Number.isFinite(Date.parse(match[1]))) result.detail = text.contactDeadline(formatTime(match[1]));
  }
  if (entry.title === "Planner failed safely") {
    return { ...result, detail: text.failureDetail, rawDetail: entry.detail };
  }
  return result;
}
