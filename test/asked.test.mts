import { strict as assert } from "node:assert";
import test from "node:test";
import {
	addableItems,
	askedGroups,
	askedList,
	askedTags,
	category,
	categoryProperty,
	withoutAsked,
} from "../src/asked.ts";

const tags = { "p:low": 2, "p:high": 1, plain: 3, "c:work": 4, other: 5 };

test("askedTags expands a category by id and keeps list order and descriptions", () => {
	assert.deepEqual(askedTags(tags, [{ id: 3 }, { group: "p" }], { 1: "urgent" }), [
		{ id: 3, name: "plain" },
		{ id: 1, name: "p:high", desc: "urgent" },
		{ id: 2, name: "p:low" },
	]);
});

test("the list drops entries gone from Toggl and offers the rest", () => {
	const asked = [{ group: "p" }, { group: "gone" }, { id: 99 }];
	assert.deepEqual(askedList(tags, asked), [
		{ item: { group: "p" }, label: "p (2 tags)" },
	]);
	assert.deepEqual(
		addableItems(tags, asked).map((c) => c.label),
		["c (1 tag)", "other", "plain"],
	);
});

test("category is the part before the first colon", () => {
	assert.equal(category("p:high ⏫"), "p");
	assert.equal(category("a:b:c"), "a");
	assert.equal(category("plain"), "");
});

test("categoryProperty keeps toggl_priority for p", () => {
	assert.equal(categoryProperty("p"), "toggl_priority");
	assert.equal(categoryProperty("area"), "toggl_area");
	assert.equal(categoryProperty(""), "toggl_tag");
});

test("askedGroups keeps list order within and across categories", () => {
	const tags = [{ name: "p:a" }, { name: "x" }, { name: "p:b" }];
	assert.deepEqual(
		[...askedGroups(tags)],
		[
			["p", [{ name: "p:a" }, { name: "p:b" }]],
			["", [{ name: "x" }]],
		],
	);
});

test("withoutAsked drops asked tags and others in their category", () => {
	assert.deepEqual(
		withoutAsked([1, 2, 3, 4, 5, 9], tags, [
			{ id: 1, name: "p:high" },
			{ id: 3, name: "plain" },
		]),
		[4, 5, 9], // p:low goes with p:high; plain tags only go by id
	);
});
