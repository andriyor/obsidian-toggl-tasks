import { EditorView } from "@codemirror/view";
import { editorInfoField, MarkdownView, Notice, Plugin, TFile } from "obsidian";
import { startButtons } from "./button";
import { PickModal } from "./pick";
import {
	DEFAULT_SETTINGS,
	ENV_FILE,
	PROJECT_PROPERTY,
	Settings,
	TogglTasksSettingTab,
} from "./settings";
import { fetchTagIds } from "./tags";
import {
	formatRef,
	formatSeconds,
	parseRef,
	parseTask,
	setTaskRef,
	setTaskTime,
	TaskRef,
} from "./task";
import { Toggl } from "./toggl";
import { RunningTimerView, VIEW_TYPE_RUNNING } from "./view";

const TOKEN_RE = /^TOGGL_API_TOKEN=["']?([^"'\n]+)/m;
/** Note property with the sum of tracked time of its tasks, in hours. */
const HOURS_PROPERTY = "toggl_hours";
/** Note property with the note's own Toggl task, `project/task`. */
const NOTE_TASK_PROPERTY = "toggl_task";
/** Note property with the priority tag name for tasks without a priority emoji. */
const PRIORITY_PROPERTY = "toggl_priority";
/** `toggl_priority` value for a note whose timers get no priority tag. */
const NO_PRIORITY = "none";

interface Project {
	name: string;
	id: number;
}

export default class TogglTasksPlugin extends Plugin {
	settings: Settings = DEFAULT_SETTINGS;
	private toggl = new Toggl(() => this.readToken());

	async onload(): Promise<void> {
		await this.loadSettings();
		this.addSettingTab(new TogglTasksSettingTab(this.app, this));

		this.registerView(
			VIEW_TYPE_RUNNING,
			(leaf) =>
				new RunningTimerView(leaf, {
					current: () => this.toggl.current(),
					projectName: (id) => this.projectName(id),
					syncNote: () => this.syncActiveNote(),
					startNote: () => this.startNoteTimer(),
				}),
		);
		this.addRibbonIcon(
			"timer",
			"Show running Toggl timer",
			() => void this.showRunning(),
		);
		this.addCommand({
			id: "show-running",
			name: "Show running timer",
			callback: () => void this.showRunning(),
		});

		this.registerEditorExtension(
			startButtons((view: EditorView, line: string) => {
				void this.startTimer(line, view.state.field(editorInfoField).file);
			}),
		);

		this.addCommand({
			id: "start-note-timer",
			name: "Start timer for current note",
			callback: () => void this.startNoteTimer(),
		});

		this.addCommand({
			id: "start-timer",
			name: "Start timer for task on current line",
			editorCallback: (editor, ctx) => {
				void this.startTimer(editor.getLine(editor.getCursor().line), ctx.file);
			},
		});

		this.addCommand({
			id: "sync-note",
			name: "Update tracked time in current note",
			checkCallback: (checking) => {
				const file = this.app.workspace.getActiveViewOfType(MarkdownView)?.file;
				if (!file) return false;
				if (!checking) void this.syncNote(file);
				return true;
			},
		});
	}

	/**
	 * Starts a timer for a task line. The first start in a project creates a
	 * Toggl task and writes `[toggl_task:: project/task]` into the line, so
	 * later starts and syncs go by id instead of by text.
	 */
	async startTimer(line: string, file: TFile | null): Promise<void> {
		const task = parseTask(line);
		if (!task?.description) {
			new Notice("Toggl: not a task line");
			return;
		}
		await this.begin(task.description, task.ref, file, task.priority, async (ref) => {
			if (file) await this.writeRef(file, line, ref);
		});
	}

	/**
	 * Starts a timer for the note last open in the editor, with the note title as
	 * description. The first start in a project creates a Toggl task for the
	 * note and saves it as the note's `toggl_task`, like task lines do.
	 */
	async startNoteTimer(): Promise<void> {
		const file = this.app.workspace.getActiveFile();
		if (file?.extension !== "md") {
			new Notice("Toggl: open a note first");
			return;
		}
		const ref = parseRef(this.noteProperty(file, NOTE_TASK_PROPERTY));
		await this.begin(file.basename, ref, file, null, async (created) => {
			const saved = formatRef(created);
			await this.app.fileManager.processFrontMatter(
				file,
				(fm: Record<string, unknown>) => {
					fm[NOTE_TASK_PROPERTY] = saved;
				},
			);
		});
	}

	/**
	 * Starts the entry with the current tags plus the `priority` tag, and shows
	 * it in the running timer view. Without a `ref`, picks the note's project and
	 * creates a Toggl task there, handing it to `save`; Esc in the picker starts
	 * without a project.
	 */
	private async begin(
		description: string,
		ref: TaskRef | null,
		file: TFile | null,
		priority: string | null,
		save: (ref: TaskRef) => Promise<void>,
	): Promise<void> {
		try {
			let projectName: string | null = null;
			if (!ref) {
				const project = await this.pickProject(file);
				if (project) {
					ref = {
						projectId: project.id,
						taskId: await this.toggl.createTask(project.id, description),
					};
					await save(ref);
					projectName = project.name;
				}
			}
			projectName ??= ref ? await this.projectName(ref.projectId) : null;
			const priorityTags = await this.loadIds(this.settings.priorityTagsPath);
			// The entry gets one priority tag, from the task or note, so drop any the
			// tags URL returns.
			const priorityIds = new Set(Object.values(priorityTags));
			const tagIds = (await fetchTagIds(this.settings.tagsUrl)).filter(
				(id) => !priorityIds.has(id),
			);
			const priorityId = await this.priorityTagId(file, priority, priorityTags);
			if (priorityId) tagIds.push(priorityId);
			const entry = await this.toggl.start(
				description,
				ref?.projectId ?? null,
				tagIds,
				ref?.taskId ?? null,
			);
			for (const leaf of this.app.workspace.getLeavesOfType(VIEW_TYPE_RUNNING)) {
				if (leaf.view instanceof RunningTimerView) void leaf.view.show(entry);
			}
			new Notice(
				`Toggl started: ${description} [${projectName ?? "no project"}] (${tagIds.length} tags)`,
			);
		} catch (e) {
			new Notice(`Toggl failed: ${e instanceof Error ? e.message : String(e)}`);
		}
	}

	/**
	 * Tag id in `tags` for the task's `priority`, else the note's. Null when the
	 * priority tags file is unset or there is no priority.
	 */
	private async priorityTagId(
		file: TFile | null,
		priority: string | null,
		tags: Record<string, number>,
	): Promise<number | null> {
		const names = Object.keys(tags);
		if (!names.length) return null;
		const name = priority ?? (file ? await this.notePriority(file, names) : null);
		if (!name || name === NO_PRIORITY) return null;
		if (!tags[name])
			new Notice(`Toggl: tag "${name}" is not in ${this.settings.priorityTagsPath}`);
		return tags[name] ?? null;
	}

	/**
	 * The note's `toggl_priority`, else a choice from `names` saved as
	 * `toggl_priority` ("none" saves no priority; Esc = none, saves nothing).
	 */
	private async notePriority(file: TFile, names: string[]): Promise<string | null> {
		const saved = this.noteProperty(file, PRIORITY_PROPERTY);
		if (typeof saved === "string") return saved;
		const picked = await new PickModal(
			this.app,
			[...names, NO_PRIORITY],
			(n) => n,
			"Toggl priority (Esc = none this time)",
		).choose();
		if (picked) {
			await this.app.fileManager.processFrontMatter(
				file,
				(fm: Record<string, unknown>) => {
					fm[PRIORITY_PROPERTY] = picked;
				},
			);
		}
		return picked;
	}

	/**
	 * Adds the Toggl task reference to the first line equal to `line`. An open
	 * note is edited through its editor: a disk write would be overwritten by the
	 * editor's next save of unsaved changes, and the next start would create a
	 * duplicate Toggl task, which Toggl rejects.
	 */
	private async writeRef(file: TFile, line: string, ref: TaskRef): Promise<void> {
		const editor = this.app.workspace
			.getLeavesOfType("markdown")
			.map((leaf) => leaf.view)
			.find((view) => view instanceof MarkdownView && view.file === file) as
			MarkdownView | undefined;
		let found = false;
		if (editor) {
			const { editor: e } = editor;
			for (let i = 0; i < e.lineCount() && !found; i++) {
				if (e.getLine(i) !== line) continue;
				e.setLine(i, setTaskRef(line, ref));
				found = true;
			}
		} else {
			await this.app.vault.process(file, (text) => {
				const lines = text.split("\n");
				const i = lines.indexOf(line);
				found = i >= 0;
				if (found) lines[i] = setTaskRef(line, ref);
				return lines.join("\n");
			});
		}
		if (!found)
			new Notice(`Toggl: task line changed, add [toggl_task:: ${formatRef(ref)}] to it`);
	}

	private async projectName(id: number): Promise<string | null> {
		return (await this.loadProjects()).find((p) => p.id === id)?.name ?? null;
	}

	/**
	 * Syncs the note last open in the editor. `getActiveFile` falls back to the
	 * most recent file, so this works from the sidebar, which takes focus.
	 */
	private async syncActiveNote(): Promise<void> {
		const file = this.app.workspace.getActiveFile();
		if (file?.extension !== "md") {
			new Notice("Toggl: open a note first");
			return;
		}
		await this.syncNote(file);
	}

	private async showRunning(): Promise<void> {
		const { workspace } = this.app;
		const leaf =
			workspace.getLeavesOfType(VIEW_TYPE_RUNNING)[0] ?? workspace.getRightLeaf(false);
		if (!leaf) return;
		await leaf.setViewState({ type: VIEW_TYPE_RUNNING, active: true });
		await workspace.revealLeaf(leaf);
	}

	/**
	 * The note's `toggl_project`, else a choice from the projects file (Esc = none)
	 * that is saved as the note's `toggl_project`.
	 */
	private async pickProject(file: TFile | null): Promise<Project | null> {
		const projects = await this.loadProjects();
		const wanted = file ? this.noteProperty(file, PROJECT_PROPERTY) : undefined;
		if (typeof wanted === "string") {
			const project = projects.find((p) => p.name === wanted);
			if (!project)
				new Notice(`Toggl: project "${wanted}" is not in ${this.settings.projectsPath}`);
			return project ?? null;
		}
		if (!projects.length) return null;
		const project = await new PickModal(
			this.app,
			projects,
			(p) => p.name,
			"Toggl project (Esc = no project)",
		).choose();
		// Remember the choice so the note's other tasks don't ask again.
		if (project && file) {
			await this.app.fileManager.processFrontMatter(
				file,
				(fm: Record<string, unknown>) => {
					fm[PROJECT_PROPERTY] = project.name;
				},
			);
		}
		return project;
	}

	private noteProperty(file: TFile, name: string): unknown {
		return this.app.metadataCache.getFileCache(file)?.frontmatter?.[name];
	}

	private async loadProjects(): Promise<Project[]> {
		const map = await this.loadIds(this.settings.projectsPath);
		return Object.entries(map).map(([name, id]) => ({ name, id }));
	}

	/** A `{ "name": id }` JSON file in the vault; empty when unset or missing. */
	private async loadIds(path: string): Promise<Record<string, number>> {
		if (!path || !(await this.app.vault.adapter.exists(path))) return {};
		return JSON.parse(await this.app.vault.adapter.read(path)) as Record<string, number>;
	}

	/**
	 * Writes `[toggl:: h:mm]` to each task with a Toggl task and the sum, plus
	 * the note's own `toggl_task`, to `toggl_hours`, with one request per
	 * project. Tasks started without a project have no Toggl task and are left
	 * as they are.
	 */
	async syncNote(file: TFile): Promise<void> {
		const tasks = (await this.app.vault.read(file))
			.split("\n")
			.flatMap((line) => parseTask(line)?.ref ?? []);
		const noteRef = parseRef(this.noteProperty(file, NOTE_TASK_PROPERTY));
		if (!tasks.length && !noteRef) {
			new Notice("Toggl: no tasks with a Toggl task in this note");
			return;
		}
		const byTask = new Map<number, number>(); // Toggl task id → seconds
		try {
			const refs = noteRef ? [...tasks, noteRef] : tasks;
			for (const pid of new Set(refs.map((t) => t.projectId))) {
				for (const [id, s] of await this.toggl.projectTaskSeconds(pid)) byTask.set(id, s);
			}
		} catch (e) {
			new Notice(`Toggl failed: ${e instanceof Error ? e.message : String(e)}`);
			return;
		}

		let total = noteRef ? (byTask.get(noteRef.taskId) ?? 0) : 0;
		await this.app.vault.process(file, (text) =>
			text
				.split("\n")
				.map((line) => {
					const ref = parseTask(line)?.ref;
					const s = ref ? byTask.get(ref.taskId) : undefined;
					if (s === undefined) return line;
					total += s;
					return setTaskTime(line, s);
				})
				.join("\n"),
		);
		await this.app.fileManager.processFrontMatter(file, (fm: Record<string, unknown>) => {
			if (total >= 60) fm[HOURS_PROPERTY] = Math.round((total / 3600) * 100) / 100;
			else delete fm[HOURS_PROPERTY];
		});
		new Notice(`Toggl: ${tasks.length} tasks, ${formatSeconds(total)} total`);
	}

	/** `TOGGL_API_TOKEN` from the vault's `.env`, shared with the vault scripts. */
	private async readToken(): Promise<string | null> {
		if (!(await this.app.vault.adapter.exists(ENV_FILE))) return null;
		const env = await this.app.vault.adapter.read(ENV_FILE);
		return TOKEN_RE.exec(env)?.[1].trim() ?? null;
	}

	async loadSettings(): Promise<void> {
		this.settings = {
			...DEFAULT_SETTINGS,
			...((await this.loadData()) as Partial<Settings>),
		};
	}
}
