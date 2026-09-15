import { Filter } from "bad-words";

// A maintained profanity/slur filter (word-boundary + basic leetspeak handling)
// rather than a hand-rolled list. Applied only to the free-text `reason` field —
// `zip` is already pattern-validated and geometry carries no text.
const filter = new Filter();

export function containsBlockedContent(text: string): boolean {
  return filter.isProfane(text);
}
