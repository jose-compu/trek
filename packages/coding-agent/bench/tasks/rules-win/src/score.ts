/** Usual table: 3 for a win and 1 for a draw. */
export function points(wins: number, draws: number): number {
	return wins * 3 + draws;
}
