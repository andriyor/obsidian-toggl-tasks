import { strict as assert } from "node:assert";
import test from "node:test";
import { formatSeconds, parseTask, setTaskRef, setTaskTime } from "../src/task.ts";

test("parseTask strips Tasks metadata, links, tags and the time field", () => {
	assert.deepEqual(
		parseTask(
			"  - [ ] ➕ 2026-10-15  перейти на [[вебхук]]? #c/work ⏫ 📅 2026-10-20 🔁 every week",
		),
		{ description: "перейти на вебхук?", done: false, ref: null },
	);
	assert.equal(
		parseTask("- [ ] read [[books/Dont Make Me Think|the book]] [toggl:: 1:20] 🆔 abc123")
			?.description,
		"read the book",
	);
	assert.deepEqual(parseTask("- [x] done ✅ 2026-10-19"), {
		description: "done",
		done: true,
		ref: null,
	});
});

test("parseTask ignores non-task lines", () => {
	assert.equal(parseTask("- plain bullet"), null);
	assert.equal(parseTask("text - [ ] not at start"), null);
});

test("setTaskTime puts the field before trailing Tasks metadata", () => {
	assert.equal(
		setTaskTime("- [ ] write docs #work ⏫ 📅 2026-10-20", 4500),
		"- [ ] write docs [toggl:: 1:15] #work ⏫ 📅 2026-10-20",
	);
	assert.equal(setTaskTime("- [ ] no metadata", 60), "- [ ] no metadata [toggl:: 0:01]");
});

test("setTaskTime replaces an existing value and removes it under a minute", () => {
	const line = "- [ ] task [toggl:: 0:10] 📅 2026-10-20";
	assert.equal(setTaskTime(line, 7200), "- [ ] task [toggl:: 2:00] 📅 2026-10-20");
	assert.equal(setTaskTime(line, 30), "- [ ] task 📅 2026-10-20");
});

test("time field round-trips without changing the description", () => {
	const line = "- [ ] fix bug 🔁 every week 📅 2026-10-20";
	assert.equal(
		parseTask(setTaskTime(line, 3600))?.description,
		parseTask(line)?.description,
	);
});

test("formatSeconds", () => {
	assert.equal(formatSeconds(0), "0:00");
	assert.equal(formatSeconds(3599), "0:59");
	assert.equal(formatSeconds(36000), "10:00");
});

test("task reference is parsed, written before metadata and kept out of the description", () => {
	const line = setTaskRef("- [ ] write docs [toggl:: 0:30] #work 📅 2026-10-20", {
		projectId: 222884173,
		taskId: 244297522,
	});
	assert.equal(
		line,
		"- [ ] write docs [toggl:: 0:30] [toggl_task:: 222884173/244297522] #work 📅 2026-10-20",
	);
	assert.deepEqual(parseTask(line), {
		description: "write docs",
		done: false,
		ref: { projectId: 222884173, taskId: 244297522 },
	});
	// updating the time keeps the reference
	assert.equal(parseTask(setTaskTime(line, 3600))?.ref?.taskId, 244297522);
});
