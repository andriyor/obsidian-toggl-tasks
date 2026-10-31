import { EditorView } from "@codemirror/view";
import { editorInfoField, MarkdownView, Notice, Plugin, TFile } from "obsidian";
import {
	addableItems,
	askedGroups,
	askedList,
	askedTags,
	category,
	categoryProperty,
	NamedTag,
	withoutAsked,
} from "./asked";
import { startButtons } from "./button";
import { PickModal } from "./pick";
import { movePinned, sortPinned } from "./pinned";
import {
	DEFAULT_SETTINGS,
	ENV_FILE,
	PROJECT_PROPERTY,
	Settings,
	TogglTasksSettingTab,
} from "./settings";
import { fetchTagIds } from "./tags";
import {
	activeChanges,
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
/** Note property value for a note whose timers get no tag of that category. */
const NO_TAG = "none";

export interface Project {
	name: string;
	id: number;
	/** Pinned in Toggl; listed in the running timer view. */
	pinned: boolean;
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
					pinnedProjects: () => this.pinnedProjects(),
					startProject: (project) => this.startProjectTimer(project),
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
			id: "update-projects",
			name: "Update projects from Toggl",
			callback: () => void this.updateProjects(),
		});

		this.addCommand({
			id: "update-tags",
			name: "Update tags from Toggl",
			callback: () => void this.updateTags(),
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
	 * Starts a timer with only a project: no description, Toggl task or priority,
	 * for time that has no note, like calls or eating.
	 */
	async startProjectTimer(project: Project): Promise<void> {
		try {
			await this.startEntry("", project.id, null, project.name, []);
		} catch (e) {
			new Notice(`Toggl failed: ${e instanceof Error ? e.message : String(e)}`);
		}
	}

	/**
	 * Starts the entry with the current tags plus an asked tag, and shows it in
	 * the running timer view. Without a `ref`, picks the note's project and
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
			projectName ??= ref ? this.projectName(ref.projectId) : null;
			await this.startEntry(
				description,
				ref?.projectId ?? null,
				ref?.taskId ?? null,
				projectName,
				await this.askedTagIds(file, priority),
			);
		} catch (e) {
			new Notice(`Toggl failed: ${e instanceof Error ? e.message : String(e)}`);
		}
	}

	/**
	 * Starts the entry with the tags URL's tags plus `askedIds`, and shows it in
	 * the running timer view.
	 */
	private async startEntry(
		description: string,
		projectId: number | null,
		taskId: number | null,
		projectName: string | null,
		askedIds: number[],
	): Promise<void> {
		const tagIds = [
			...withoutAsked(
				await fetchTagIds(this.settings.tagsUrl),
				this.settings.tags,
				this.askedTags(),
			),
			...askedIds,
		];
		const entry = await this.toggl.start(description, projectId, tagIds, taskId);
		for (const leaf of this.app.workspace.getLeavesOfType(VIEW_TYPE_RUNNING)) {
			if (leaf.view instanceof RunningTimerView) leaf.view.show(entry);
		}
		new Notice(
			`Toggl started: ${description || "(no description)"} [${projectName ?? "no project"}] (${tagIds.length} tags)`,
		);
	}

	/**
	 * One asked tag per category: the task's `priority` if it is of that category,
	 * else the note's.
	 */
	private async askedTagIds(
		file: TFile | null,
		priority: string | null,
	): Promise<number[]> {
		const ids: number[] = [];
		for (const [cat, group] of askedGroups(this.askedTags())) {
			const fromTask = priority !== null && category(priority) === cat ? priority : null;
			const name = fromTask ?? (file ? await this.noteTag(file, cat, group) : null);
			if (!name || name === NO_TAG) continue;
			const tag = group.find((t) => t.name === name);
			if (tag) ids.push(tag.id);
			else new Notice(`Toggl: tag "${name}" is not in the asked tags`);
		}
		return ids;
	}

	/**
	 * The note's property for `cat`, else a choice from `tags`, shown with their
	 * descriptions and saved to that property ("none" saves no tag; Esc = none,
	 * saves nothing).
	 */
	private async noteTag(
		file: TFile,
		cat: string,
		tags: NamedTag[],
	): Promise<string | null> {
		const property = categoryProperty(cat);
		const saved = this.noteProperty(file, property);
		if (typeof saved === "string") return saved;
		const descs = new Map(tags.map((t) => [t.name, t.desc]));
		descs.set(NO_TAG, "No tag, and this note doesn't ask again");
		const picked = await new PickModal(
			this.app,
			[...descs.keys()],
			(name) => name,
			`Toggl ${cat ? `${cat}: ` : ""}tag (Esc = none this time)`,
			(name) => descs.get(name),
		).choose();
		if (picked) {
			await this.app.fileManager.processFrontMatter(
				file,
				(fm: Record<string, unknown>) => {
					fm[property] = picked;
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

	private projectName(id: number): string | null {
		return this.projects().find((p) => p.id === id)?.name ?? null;
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
	 * The note's `toggl_project`, else a choice from the projects (Esc = none)
	 * that is saved as the note's `toggl_project`.
	 */
	private async pickProject(file: TFile | null): Promise<Project | null> {
		const projects = this.projects();
		const wanted = file ? this.noteProperty(file, PROJECT_PROPERTY) : undefined;
		if (typeof wanted === "string") {
			const project = projects.find((p) => p.name === wanted);
			if (!project)
				new Notice(
					`Toggl: project "${wanted}" not found, run "Update projects from Toggl"`,
				);
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

	/** The projects saved by `updateProjects`, sorted by name. */
	private projects(): Project[] {
		return Object.entries(this.settings.projects).map(([name, value]) => ({
			name,
			...value,
		}));
	}

	/** Saves Toggl's active projects to the plugin data, sorted by name. */
	async updateProjects(): Promise<void> {
		try {
			const projects = (await this.toggl.projects()).sort((a, b) =>
				a.name.toLowerCase().localeCompare(b.name.toLowerCase()),
			);
			this.settings.projects = Object.fromEntries(
				projects.map(({ name, id, pinned }) => [name, { id, pinned }]),
			);
			await this.saveData(this.settings);
			this.renderRunningViews();
			new Notice(`Toggl: ${projects.length} projects updated`);
		} catch (e) {
			new Notice(`Toggl failed: ${e instanceof Error ? e.message : String(e)}`);
		}
	}

	/** Projects pinned in Toggl, in the order set in the plugin settings. */
	pinnedProjects(): Project[] {
		return sortPinned(this.projects(), this.settings.pinnedOrder);
	}

	/** Moves a pinned project from index `from` to `to` of `pinnedProjects`. */
	async movePinnedProject(from: number, to: number): Promise<void> {
		this.settings.pinnedOrder = movePinned(this.pinnedProjects(), from, to);
		await this.saveData(this.settings);
		this.renderRunningViews();
	}

	private renderRunningViews(): void {
		for (const leaf of this.app.workspace.getLeavesOfType(VIEW_TYPE_RUNNING)) {
			if (leaf.view instanceof RunningTimerView) leaf.view.render();
		}
	}

	/** Tries the token against Toggl; only on click, `/me` is limited to 30 per hour. */
	async checkToken(): Promise<void> {
		try {
			new Notice(`Toggl: token works, signed in as ${await this.toggl.account()}`);
		} catch (e) {
			new Notice(`Toggl failed: ${e instanceof Error ? e.message : String(e)}`);
		}
	}

	/** Saves Toggl's tags to the plugin data; asked tags stay, going by id. */
	async updateTags(): Promise<void> {
		try {
			const tags = await this.toggl.tags();
			this.settings.tags = Object.fromEntries(tags.map(({ name, id }) => [name, id]));
			await this.saveData(this.settings);
			new Notice(`Toggl: ${tags.length} tags updated`);
		} catch (e) {
			new Notice(`Toggl failed: ${e instanceof Error ? e.message : String(e)}`);
		}
	}

	/** The tags the asked list stands for. */
	askedTags(): NamedTag[] {
		return askedTags(
			this.settings.tags,
			this.settings.askedItems,
			this.settings.tagDescs,
		);
	}

	/** Picks a category or tag that isn't in the asked list and adds it last. */
	async addAskedItem(): Promise<void> {
		const items = addableItems(this.settings.tags, this.settings.askedItems);
		if (!items.length) {
			new Notice("Toggl: nothing to add, update tags from Toggl first");
			return;
		}
		const picked = await new PickModal(
			this.app,
			items,
			(c) => c.label,
			"Category or tag to ask before starting a timer",
		).choose();
		if (!picked) return;
		this.settings.askedItems.push(picked.item);
		await this.saveData(this.settings);
	}

	/** `from` and `to` are indices of the asked list shown in the settings. */
	async moveAskedItem(from: number, to: number): Promise<void> {
		const items = this.shownAskedItems();
		items.splice(to, 0, ...items.splice(from, 1));
		this.settings.askedItems = items;
		await this.saveData(this.settings);
	}

	/** `index` is an index of the asked list shown in the settings. */
	async removeAskedItem(index: number): Promise<void> {
		const items = this.shownAskedItems();
		items.splice(index, 1);
		this.settings.askedItems = items;
		await this.saveData(this.settings);
	}

	async setTagDesc(id: number, desc: string): Promise<void> {
		if (desc) this.settings.tagDescs[id] = desc;
		else delete this.settings.tagDescs[id];
		await this.saveData(this.settings);
	}

	/** The saved list without entries gone from Toggl, as the settings show it. */
	private shownAskedItems() {
		return askedList(this.settings.tags, this.settings.askedItems).map((c) => c.item);
	}

	/**
	 * Writes `[toggl:: h:mm]` to each task with a Toggl task and the sum, plus
	 * the note's own `toggl_task`, to `toggl_hours`, with one request per
	 * project, then marks Toggl tasks done or reopens them to match their lines.
	 * Tasks started without a project have no Toggl task and are left as they are.
	 */
	async syncNote(file: TFile): Promise<void> {
		const lines = (await this.app.vault.read(file))
			.split("\n")
			.flatMap((line) => parseTask(line) ?? []);
		const tasks = lines.flatMap((task) => task.ref ?? []);
		const noteRef = parseRef(this.noteProperty(file, NOTE_TASK_PROPERTY));
		if (!tasks.length && !noteRef) {
			new Notice("Toggl: no tasks with a Toggl task in this note");
			return;
		}
		const byTask = new Map<number, { seconds: number; active: boolean }>();
		try {
			const refs = noteRef ? [...tasks, noteRef] : tasks;
			for (const pid of new Set(refs.map((t) => t.projectId))) {
				for (const [id, t] of await this.toggl.projectTasks(pid)) byTask.set(id, t);
			}
		} catch (e) {
			new Notice(`Toggl failed: ${e instanceof Error ? e.message : String(e)}`);
			return;
		}

		let total = noteRef ? (byTask.get(noteRef.taskId)?.seconds ?? 0) : 0;
		await this.app.vault.process(file, (text) =>
			text
				.split("\n")
				.map((line) => {
					const ref = parseTask(line)?.ref;
					const s = ref ? byTask.get(ref.taskId)?.seconds : undefined;
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
		// After the time is written, so a failure here doesn't lose it.
		let done = 0;
		let reopened = 0;
		try {
			for (const { ref, active } of activeChanges(lines, byTask)) {
				await this.toggl.setTaskActive(ref, active);
				if (active) reopened++;
				else done++;
			}
		} catch (e) {
			new Notice(`Toggl failed: ${e instanceof Error ? e.message : String(e)}`);
		}
		const changes = [done && `${done} marked done`, reopened && `${reopened} reopened`]
			.filter(Boolean)
			.join(", ");
		new Notice(
			`Toggl: ${tasks.length} tasks, ${formatSeconds(total)} total` +
				(changes ? `, ${changes}` : ""),
		);
	}

	/** `TOGGL_API_TOKEN` from the vault's `.env`, shared with the vault scripts. */
	private async readToken(): Promise<string | null> {
		if (!(await this.app.vault.adapter.exists(ENV_FILE))) return null;
		const env = await this.app.vault.adapter.read(ENV_FILE);
		return TOKEN_RE.exec(env)?.[1].trim() ?? null;
	}

	/** Without this, the next save would overwrite outside edits to `data.json`. */
	async onExternalSettingsChange(): Promise<void> {
		await this.loadSettings();
		this.renderRunningViews();
	}

	async loadSettings(): Promise<void> {
		this.settings = {
			...DEFAULT_SETTINGS,
			...((await this.loadData()) as Partial<Settings>),
		};
	}
}
