/**
 * Fixed probes for optional hierarchy performance runs.
 * Speed is tokens per second from output tokens and wall time.
 * IQ is how many of these items the reply matches. It is not a general benchmark.
 */

export interface HierarchyProbe {
	id: string;
	prompt: string;
	expect: RegExp;
}

export const HIERARCHY_PROBES: readonly HierarchyProbe[] = [
	{
		id: "arithmetic",
		prompt: "What is 17 + 25? Reply with digits only.",
		expect: /\b42\b/,
	},
	{
		id: "tool",
		prompt: "Which tool reads a file: read, write, or delete? Reply with one word.",
		expect: /\bread\b/i,
	},
	{
		id: "logic",
		prompt: "If all bloops are razzes and all razzes are lazzes, are all bloops lazzes? Reply yes or no.",
		expect: /\byes\b/i,
	},
];

export interface ProbeScore {
	id: string;
	correct: boolean;
	elapsedMs: number;
	outputTokens: number;
	tokensPerSecond: number;
}

export interface PerformanceReport {
	label: string;
	modelId: string;
	scores: ProbeScore[];
	correct: number;
	total: number;
	elapsedMs: number;
	tokensPerSecond: number;
}

export function scoreProbeText(text: string, probe: HierarchyProbe): boolean {
	return probe.expect.test(text);
}

export function tokensPerSecond(outputTokens: number, elapsedMs: number): number {
	if (outputTokens <= 0 || elapsedMs <= 0) {
		return 0;
	}
	return (outputTokens / elapsedMs) * 1000;
}

export function summarizePerformance(label: string, modelId: string, scores: readonly ProbeScore[]): PerformanceReport {
	const elapsedMs = scores.reduce((sum, score) => sum + score.elapsedMs, 0);
	const outputTokens = scores.reduce((sum, score) => sum + score.outputTokens, 0);
	return {
		label,
		modelId,
		scores: [...scores],
		correct: scores.filter((score) => score.correct).length,
		total: scores.length,
		elapsedMs,
		tokensPerSecond: tokensPerSecond(outputTokens, elapsedMs),
	};
}

export function formatPerformance(report: PerformanceReport): string {
	const items = report.scores
		.map((score) => `${score.id} ${score.correct ? "ok" : "miss"} ${score.tokensPerSecond.toFixed(1)} tok/s`)
		.join("; ");
	return `${report.label} ${report.modelId}: IQ ${report.correct}/${report.total}, ${report.tokensPerSecond.toFixed(1)} tok/s, ${report.elapsedMs} ms (${items})`;
}
