/**
 * One clarifying question. The model does not run on that turn.
 * A later turn in the same process is the answer and is not asked again.
 */

const AMBIGUOUS = /^(?:please\s+)?(?:fix|change|update|make|handle)\s+(?:it|this|that)\b[.!?\s]*$/i;
const DESTRUCTIVE = /\brm\s+-rf\b|\bdrop\s+(?:the\s+)?database\b|\bgit\s+push\b[^\n]*--force\b/i;
const LOW_CONFIDENCE = /\b(not sure|i guess|low confidence)\b/i;

export function curiosityQuestion(text: string): string | undefined {
	const trimmed = text.trim();
	if (trimmed.length === 0 || trimmed.startsWith("/")) return undefined;
	if (DESTRUCTIVE.test(trimmed)) {
		return "Which exact path or command should stay untouched?";
	}
	const short = trimmed.split(/\s+/).length < 12;
	if (AMBIGUOUS.test(trimmed) || (LOW_CONFIDENCE.test(trimmed) && short)) {
		return "What should change, and which file or command is in scope?";
	}
	return undefined;
}
