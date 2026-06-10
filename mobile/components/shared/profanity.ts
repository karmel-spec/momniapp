// Basic objectionable-content filter (Apple Guideline 1.2).
// Small word list — report/block flows are the real safety net.
const BAD_WORDS = [
  'fuck', 'shit', 'bitch', 'asshole', 'bastard', 'cunt', 'dick', 'pussy',
  'slut', 'whore', 'damn you', 'nigger', 'faggot', 'retard',
];

export const KINDNESS_NOTE = "Let's keep the Circle kind, mama";

export function hasProfanity(text: string): boolean {
  const lowered = text.toLowerCase();
  return BAD_WORDS.some((w) => new RegExp(`\\b${w.replace(/ /g, '\\s+')}\\b`).test(lowered));
}
