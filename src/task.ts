// Task line parsing. The cleaned task text is the Toggl description, so the
// same text must come out both when a timer starts and when time is synced.

const TASK_RE = /^\s*[-*+] \[(.)\] (.*)$/;
const TIME_FIELD = "toggl";
const TIME_FIELD_RE = /\s*\[toggl:: [^\]]*\]/gu;

// Tasks plugin metadata (emoji format).
const META_RE = new RegExp(
	[
		/[➕📅⏳🛫✅❌]️?\s*\d{4}-\d{2}-\d{2}/u.source, // dates
		/🔁[^➕📅⏳🛫✅❌🏁🆔⛔⏫🔼🔽⏬🔺#]*/u.source, // recurrence, up to the next field
		/(?:🆔|⛔|🏁)️?\s*\S+/u.source, // id, depends on, on completion
		/[⏫🔼🔽⏬🔺]️?/u.source, // priority
		/#\S+/u.source, // tags
	].join("|"),
	"gu",
);
// Trailing run of metadata: Tasks only reads fields at the end of the line, so
// the time field goes before it.
const TRAILING_META_RE = new RegExp(`(?:\\s+(?:${META_RE.source}))+\\s*$`, "u");

const DONE_STATUSES = new Set(["x", "X", "-"]);

export interface Task {
	/** Toggl description: task text without metadata, links or the time field. */
	description: string;
	done: boolean;
}

export function parseTask(line: string): Task | null {
	const m = TASK_RE.exec(line);
	if (!m) return null;
	const description = m[2]
		.replace(TIME_FIELD_RE, "")
		.replace(META_RE, "")
		.replace(/\[\[(?:[^\]|]*\|)?([^\]]*)\]\]/gu, "$1") // [[note|alias]] → alias
		.replace(/\s+/g, " ")
		.trim();
	return { description, done: DONE_STATUSES.has(m[1]) };
}

/** `h:mm`, e.g. 4500 → "1:15". */
export function formatSeconds(seconds: number): string {
	const minutes = Math.floor(seconds / 60);
	return `${Math.floor(minutes / 60)}:${String(minutes % 60).padStart(2, "0")}`;
}

/** Writes `[toggl:: h:mm]` into a task line, or removes it when under a minute. */
export function setTaskTime(line: string, seconds: number): string {
	const bare = line.replace(TIME_FIELD_RE, "");
	if (seconds < 60) return bare;
	const field = ` [${TIME_FIELD}:: ${formatSeconds(seconds)}]`;
	const meta = TRAILING_META_RE.exec(bare);
	return meta ? bare.slice(0, meta.index) + field + bare.slice(meta.index) : bare + field;
}
