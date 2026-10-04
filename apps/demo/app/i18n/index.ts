import { en } from "./en";
import { zh } from "./zh";

export type Language = "en" | "zh";
export const translations = { en, zh };
export const uiMessages = { en: en.ui, zh: zh.ui };
