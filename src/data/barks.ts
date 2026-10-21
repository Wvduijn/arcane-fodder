/**
 * Volunteer! barks (GDD §11, M6 Q5), shown in a bubble over the volunteer for the sprint. Tone:
 * grizzled veterans who keep being called rookies (ADR 0005 R8), Cannon Fodder dark comedy; never
 * childish, no real people, no slurs. Each line ≤ 28 chars so it fits the bubble on one line
 * (readability §5c). Seeded pick that never repeats the previous line. Longest: 28.
 */
export const VOLUNTEER_BARKS = [
  'Forty years. Still a rookie.',
  "I'm too old to be a rookie!",
  'Rookie mistake. Mine.',
  'Basic training covered this.',
  'I volunteer! Wait, what?',
  'Who wrote my name down?!',
  'Finally, a promotion!',
  'My pension was a lie anyway.',
  'Hold my hat. Forever.',
  'Save me a seat on Hat Hill.',
  'Tell my cat I said nothing.',
  "Third time's the charm!",
] as const satisfies readonly string[];
