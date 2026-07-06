// Owner control commands. When Oleh sends a message from his own account, the
// webhook arrives as an echo (is_echo: true). If that echo is addressed to the
// assistant ("Eve" / "Єва") with a stop/resume keyword, we toggle the bot for
// that conversation instead of treating it as a normal message.
//
// Matching is owner-only by construction: only echoes (messages the account
// itself sent) are checked, so an end user typing "Eve, stop" can't pause it.

export type ControlCommand = "pause" | "resume";

// The assistant answers to Eve / Єва / Ева (Latin + Ukrainian + Russian).
const NAME = /(\beve\b|єва|ева)/i;

// "stop", "стоп", "стій", "пауза", "зупин(ись)"
const PAUSE = /(\bstop\b|\bpause\b|стоп|стій|пауза|зупин)/i;

// "resume", "start", "continue", "go", "продовж", "далі", "старт", "віднов"
const RESUME = /(\bresume\b|\bcontinue\b|\bstart\b|\bgo\b|продовж|далі|старт|віднов)/i;

/**
 * Parse an owner echo's text into a control command, or null if it isn't one.
 * Requires the assistant's name to be present so ordinary owner replies that
 * happen to contain "stop" don't pause the bot.
 */
export function parseControlCommand(text: string): ControlCommand | null {
  if (!NAME.test(text)) return null;
  // Check resume before pause so "Eve, start again" isn't caught by a stray match.
  if (RESUME.test(text)) return "resume";
  if (PAUSE.test(text)) return "pause";
  return null;
}
