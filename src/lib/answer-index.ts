/**
 * One canonical definition of a valid answer index (Phase 2A).
 *
 * An answer is valid ONLY when it is an integer inside the actual
 * question-option range [0, optionCount). Out-of-range, non-integer or
 * missing selections are treated as SKIPPED — never as a valid wrong
 * answer — and the result view can never render undefined option text.
 *
 * The server is authoritative: the transport schema may accept a wider
 * sanity bound, but scoring, autosave merging and result rendering all
 * go through this single check.
 */
export function isValidAnswerIndex(selected: unknown, optionCount: number): boolean {
  return (
    optionCount > 0 &&
    typeof selected === 'number' &&
    Number.isInteger(selected) &&
    selected >= 0 &&
    selected < optionCount
  )
}
