/**
 * Pinned `projects` in the hand-set `order` of ids. Projects pinned later in
 * Toggl, not in `order` yet, go last in their own order.
 */
export function sortPinned<P extends { id: number; pinned: boolean }>(
	projects: P[],
	order: number[],
): P[] {
	const rank = (p: P): number => {
		const i = order.indexOf(p.id);
		return i < 0 ? order.length : i;
	};
	return projects.filter((p) => p.pinned).sort((a, b) => rank(a) - rank(b));
}

/** Ids of `pinned` after moving the one at `from` to `to`. */
export function movePinned(pinned: { id: number }[], from: number, to: number): number[] {
	const ids = pinned.map((p) => p.id);
	ids.splice(to, 0, ...ids.splice(from, 1));
	return ids;
}
