// Task line parsing. The cleaned task text is the Toggl description, so the
// same text must come out both when a timer starts and when time is synced.

const TASK_RE = /^\s*[-*+] \[(.)\] (.*)$/;
/** Inline fields this plugin writes: tracked time and the Toggl task reference. */
const TIME_FIELD = "toggl";
const REF_FIELD = "toggl_task";
const OWN_FIELDS_RE = /\s*\[toggl(?:_task)?:: [^\]]*\]/gu;
const REF_RE = /\[toggl_task:: (\d+)\/(\d+)\]/u;
const REF_VALUE_RE = /^(\d+)\/(\d+)$/u;
const TIME_RE = /\[toggl:: ([^\]]*)\]/u;
const PRIORITY_RE = /[🔺⏫🔼🔽⏬]/u;
/** Tasks priority emoji → Toggl tag name, looked up in the priority tags file. */
const PRIORITY_TAGS: Record<string, string> = {
	"🔺": "p:highest 🔺",
	"⏫": "p:high ⏫",
	"🔼": "p:medium 🔼",
	"🔽": "p:low 🔽",
	"⏬": "p:lowest ⏬",
};

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

/** A Toggl task; time entries for it need both ids. */
export interface TaskRef {
	projectId: number;
	taskId: number;
}

export interface Task {
	/** Toggl description: task text without metadata, links or this plugin's fields. */
	description: string;
	done: boolean;
	ref: TaskRef | null;
	/** Last synced `h:mm`, if any. */
	time: string | null;
	/** Toggl tag name for the Tasks priority, e.g. `p:high` for ⏫. */
	priority: string | null;
}

export function parseTask(line: string): Task | null {
	const m = TASK_RE.exec(line);
	if (!m) return null;
	const description = m[2]
		.replace(OWN_FIELDS_RE, "")
		.replace(META_RE, "")
		.replace(/\[\[(?:[^\]|]*\|)?([^\]]*)\]\]/gu, "$1") // [[note|alias]] → alias
		.replace(/\s+/g, " ")
		.trim();
	const ref = REF_RE.exec(m[2]);
	return {
		description,
		done: DONE_STATUSES.has(m[1]),
		ref: ref ? { projectId: Number(ref[1]), taskId: Number(ref[2]) } : null,
		time: TIME_RE.exec(m[2])?.[1] ?? null,
		priority: PRIORITY_TAGS[PRIORITY_RE.exec(m[2])?.[0] ?? ""] ?? null,
	};
}

/** `h:mm`, e.g. 4500 → "1:15". */
export function formatSeconds(seconds: number): string {
	const minutes = Math.floor(seconds / 60);
	return `${Math.floor(minutes / 60)}:${String(minutes % 60).padStart(2, "0")}`;
}

/** Writes `[toggl:: h:mm]` into a task line, or removes it when under a minute. */
export function setTaskTime(line: string, seconds: number): string {
	return setField(line, TIME_FIELD, seconds < 60 ? null : formatSeconds(seconds));
}

/** `project/task`, the form a reference is stored in. */
export function formatRef(ref: TaskRef): string {
	return `${ref.projectId}/${ref.taskId}`;
}

/** Reads `project/task`, e.g. a note's `toggl_task` property; null if malformed. */
export function parseRef(value: unknown): TaskRef | null {
	const m = typeof value === "string" ? REF_VALUE_RE.exec(value.trim()) : null;
	return m ? { projectId: Number(m[1]), taskId: Number(m[2]) } : null;
}

/** Writes `[toggl_task:: project/task]` into a task line. */
export function setTaskRef(line: string, ref: TaskRef): string {
	return setField(line, REF_FIELD, formatRef(ref));
}

/** Replaces or removes `[name:: value]`, keeping it before trailing Tasks metadata. */
function setField(line: string, name: string, value: string | null): string {
	const bare = line.replace(new RegExp(`\\s*\\[${name}:: [^\\]]*\\]`, "gu"), "");
	if (value === null) return bare;
	const field = ` [${name}:: ${value}]`;
	const meta = TRAILING_META_RE.exec(bare);
	return meta ? bare.slice(0, meta.index) + field + bare.slice(meta.index) : bare + field;
}
