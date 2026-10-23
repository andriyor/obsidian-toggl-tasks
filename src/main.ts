import { EditorView } from "@codemirror/view";
import {
	App,
	editorInfoField,
	FuzzySuggestModal,
	MarkdownView,
	Notice,
	Plugin,
	PluginSettingTab,
	Setting,
	TFile,
} from "obsidian";
import { startButtons } from "./button";
import { fetchTagIds } from "./tags";
import { formatSeconds, parseTask, setTaskRef, setTaskTime, TaskRef } from "./task";
import { Toggl } from "./toggl";
import { RunningTimerView, VIEW_TYPE_RUNNING } from "./view";

/** Vault-root file with `TOGGL_API_TOKEN=...`; keep it out of git. */
const ENV_FILE = ".env";
const TOKEN_RE = /^TOGGL_API_TOKEN=["']?([^"'\n]+)/m;
/** Note property naming the Toggl project for its tasks. */
const PROJECT_PROPERTY = "toggl_project";
/** Note property with the sum of tracked time of its tasks, in hours. */
const HOURS_PROPERTY = "toggl_hours";

interface Settings {
	/** Vault path of a `{ "project name": id }` JSON file. */
	projectsPath: string;
	/** URL returning `[{ id }]` of tags to attach to every new timer. */
	tagsUrl: string;
}

const DEFAULT_SETTINGS: Settings = { projectsPath: "", tagsUrl: "" };

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
		try {
			let ref = task.ref;
			let projectName: string | null = null;
			if (!ref) {
				const project = await this.pickProject(file);
				if (project) {
					ref = {
						projectId: project.id,
						taskId: await this.toggl.createTask(project.id, task.description),
					};
					if (file) await this.writeRef(file, line, ref);
					projectName = project.name;
				}
			}
			projectName ??= ref ? await this.projectName(ref.projectId) : null;
			await this.begin(task.description, ref, projectName);
		} catch (e) {
			new Notice(`Toggl failed: ${e instanceof Error ? e.message : String(e)}`);
		}
	}

	/**
	 * Starts a timer for the note last open in the editor: its project (picked
	 * and saved like for tasks), the note title as description, no Toggl task.
	 */
	async startNoteTimer(): Promise<void> {
		const file = this.app.workspace.getActiveFile();
		if (file?.extension !== "md") {
			new Notice("Toggl: open a note first");
			return;
		}
		try {
			const project = await this.pickProject(file);
			await this.begin(
				file.basename,
				project && { projectId: project.id, taskId: null },
				project?.name ?? null,
			);
		} catch (e) {
			new Notice(`Toggl failed: ${e instanceof Error ? e.message : String(e)}`);
		}
	}

	/** Starts the entry with the current tags and shows it in the running timer view. */
	private async begin(
		description: string,
		ref: { projectId: number; taskId: number | null } | null,
		projectName: string | null,
	): Promise<void> {
		const tagIds = await fetchTagIds(this.settings.tagsUrl);
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
	}

	/** Adds the Toggl task reference to the first line equal to `line`. */
	private async writeRef(file: TFile, line: string, ref: TaskRef): Promise<void> {
		await this.app.vault.process(file, (text) => {
			const lines = text.split("\n");
			const i = lines.indexOf(line);
			if (i >= 0) lines[i] = setTaskRef(line, ref);
			return lines.join("\n");
		});
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
		const wanted: unknown = file
			? this.app.metadataCache.getFileCache(file)?.frontmatter?.[PROJECT_PROPERTY]
			: undefined;
		if (typeof wanted === "string") {
			const project = projects.find((p) => p.name === wanted);
			if (!project)
				new Notice(`Toggl: project "${wanted}" is not in ${this.settings.projectsPath}`);
			return project ?? null;
		}
		if (!projects.length) return null;
		const project = await new ProjectModal(this.app, projects).choose();
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

	private async loadProjects(): Promise<Project[]> {
		const path = this.settings.projectsPath;
		if (!path || !(await this.app.vault.adapter.exists(path))) return [];
		const map = JSON.parse(await this.app.vault.adapter.read(path)) as Record<
			string,
			number
		>;
		return Object.entries(map).map(([name, id]) => ({ name, id }));
	}

	/**
	 * Writes `[toggl:: h:mm]` to each task with a Toggl task and the sum to
	 * `toggl_hours`, with one request per project. Tasks started without a
	 * project have no Toggl task and are left as they are.
	 */
	async syncNote(file: TFile): Promise<void> {
		const tasks = (await this.app.vault.read(file))
			.split("\n")
			.flatMap((line) => parseTask(line)?.ref ?? []);
		if (!tasks.length) {
			new Notice("Toggl: no tasks with a Toggl task in this note");
			return;
		}
		const byTask = new Map<number, number>(); // Toggl task id → seconds
		try {
			for (const pid of new Set(tasks.map((t) => t.projectId))) {
				for (const [id, s] of await this.toggl.projectTaskSeconds(pid)) byTask.set(id, s);
			}
		} catch (e) {
			new Notice(`Toggl failed: ${e instanceof Error ? e.message : String(e)}`);
			return;
		}

		let total = 0;
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

	async saveSettings(): Promise<void> {
		await this.saveData(this.settings);
	}
}

class ProjectModal extends FuzzySuggestModal<Project> {
	private resolve: (project: Project | null) => void = () => {};

	constructor(
		app: App,
		private readonly projects: Project[],
	) {
		super(app);
		this.setPlaceholder("Toggl project (Esc = no project)");
	}

	choose(): Promise<Project | null> {
		return new Promise((resolve) => {
			this.resolve = resolve;
			this.open();
		});
	}

	getItems(): Project[] {
		return this.projects;
	}

	getItemText(project: Project): string {
		return project.name;
	}

	onChooseItem(project: Project): void {
		this.resolve(project);
	}

	onClose(): void {
		// Runs before onChooseItem when an item is picked, so let that win.
		window.setTimeout(() => this.resolve(null), 0);
	}
}

class TogglTasksSettingTab extends PluginSettingTab {
	constructor(
		app: App,
		private readonly plugin: TogglTasksPlugin,
	) {
		super(app, plugin);
	}

	display(): void {
		const { containerEl } = this;
		containerEl.empty();

		new Setting(containerEl)
			.setName("API token")
			.setDesc(`Read from TOGGL_API_TOKEN in ${ENV_FILE} at the vault root.`);

		new Setting(containerEl)
			.setName("Projects file")
			.setDesc(
				`Vault path of a JSON file mapping project names to ids. A note's "${PROJECT_PROPERTY}" property picks one; otherwise you choose when starting.`,
			)
			.addText((text) =>
				text
					.setPlaceholder("scripts/toggl-projects.json")
					.setValue(this.plugin.settings.projectsPath)
					.onChange(async (value) => {
						this.plugin.settings.projectsPath = value.trim();
						await this.plugin.saveSettings();
					}),
			);

		new Setting(containerEl)
			.setName("Tags URL")
			.setDesc("Optional. Returns [{ id }] of tags added to every new timer.")
			.addText((text) =>
				text
					.setPlaceholder("https://tags.lan/api/selected-tags")
					.setValue(this.plugin.settings.tagsUrl)
					.onChange(async (value) => {
						this.plugin.settings.tagsUrl = value.trim();
						await this.plugin.saveSettings();
					}),
			);
	}
}
