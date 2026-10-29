import { strict as assert } from "node:assert";
import test from "node:test";
import { movePinned, sortPinned } from "../src/pinned.ts";

const projects = [
	{ id: 1, pinned: true },
	{ id: 2, pinned: false },
	{ id: 3, pinned: true },
	{ id: 4, pinned: true },
];

test("sortPinned keeps the saved order, new pinned projects go last", () => {
	assert.deepEqual(
		sortPinned(projects, [3, 2, 1]).map((p) => p.id),
		[3, 1, 4],
	);
	assert.deepEqual(
		sortPinned(projects, []).map((p) => p.id),
		[1, 3, 4],
	);
});

test("movePinned moves one id", () => {
	const pinned = sortPinned(projects, []);
	assert.deepEqual(movePinned(pinned, 2, 0), [4, 1, 3]);
	assert.deepEqual(movePinned(pinned, 0, 2), [3, 4, 1]);
});
