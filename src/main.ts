import { EditorView } from "@codemirror/view";
import {
	App,
	editorInfoField,
	FuzzySuggestModal,
	MarkdownView,
	Notice,
	Plugin,
	PluginSettingTab,
	SecretComponent,
	Setting,
	TFile,
} from "obsidian";
import { startButtons } from "./button";
import { fetchTagIds } from "./tags";
import { formatSeconds, parseTask, setTaskTime } from "./task";
import { Toggl } from "./toggl";

/** Note property naming the Toggl project for its tasks. */
const PROJECT_PROPERTY = "toggl_project";
/** Note property with the sum of tracked time of its tasks, in hours. */
const HOURS_PROPERTY = "toggl_hours";

interface Settings {
	/** Name of the secret in Obsidian's secret storage holding the API token. */
	tokenSecret: string;
	/** Vault path of a `{ "project name": id }` JSON file. */
	projectsPath: string;
	/** URL returning `[{ id }]` of tags to attach to every new timer. */
	tagsUrl: string;
}

const DEFAULT_SETTINGS: Settings = { tokenSecret: "", projectsPath: "", tagsUrl: "" };

interface Project {
	name: string;
	id: number;
}

export default class TogglTasksPlugin extends Plugin {
	settings: Settings = DEFAULT_SETTINGS;
	private toggl = new Toggl(() =>
		this.settings.tokenSecret
			? this.app.secretStorage.getSecret(this.settings.tokenSecret)
			: null,
	);

	async onload(): Promise<void> {
		await this.loadSettings();
		this.addSettingTab(new TogglTasksSettingTab(this.app, this));

		this.registerEditorExtension(
			startButtons((view: EditorView, line: string) => {
				void this.startTimer(line, view.state.field(editorInfoField).file);
			}),
		);

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

	async startTimer(line: string, file: TFile | null): Promise<void> {
		const task = parseTask(line);
		if (!task?.description) {
			new Notice("Toggl: not a task line");
			return;
		}
		try {
			const project = await this.pickProject(file);
			const tagIds = await fetchTagIds(this.settings.tagsUrl);
			await this.toggl.start(task.description, project?.id ?? null, tagIds);
			new Notice(
				`Toggl started: ${task.description} [${project?.name ?? "no project"}] (${tagIds.length} tags)`,
			);
		} catch (e) {
			new Notice(`Toggl failed: ${e instanceof Error ? e.message : String(e)}`);
		}
	}

	/** The note's `toggl_project`, else a choice from the projects file (Esc = none). */
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
		return projects.length ? new ProjectModal(this.app, projects).choose() : null;
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

	/** Writes `[toggl:: h:mm]` to each task and the sum to `toggl_hours`. */
	async syncNote(file: TFile): Promise<void> {
		const descriptions = new Set<string>();
		for (const line of (await this.app.vault.read(file)).split("\n")) {
			const description = parseTask(line)?.description;
			if (description) descriptions.add(description);
		}
		if (!descriptions.size) {
			new Notice("Toggl: no tasks in this note");
			return;
		}
		const seconds = new Map<string, number>();
		try {
			// Sequential: the Reports API allows a few hundred requests per hour.
			for (const d of descriptions) seconds.set(d, await this.toggl.trackedSeconds(d));
		} catch (e) {
			new Notice(`Toggl failed: ${e instanceof Error ? e.message : String(e)}`);
			return;
		}

		let total = 0;
		await this.app.vault.process(file, (text) =>
			text
				.split("\n")
				.map((line) => {
					const description = parseTask(line)?.description;
					if (!description || !seconds.has(description)) return line;
					const s = seconds.get(description) ?? 0;
					total += s;
					return setTaskTime(line, s);
				})
				.join("\n"),
		);
		await this.app.fileManager.processFrontMatter(file, (fm: Record<string, unknown>) => {
			if (total >= 60) fm[HOURS_PROPERTY] = Math.round((total / 3600) * 100) / 100;
			else delete fm[HOURS_PROPERTY];
		});
		new Notice(`Toggl: ${descriptions.size} tasks, ${formatSeconds(total)} total`);
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
			.setDesc("Toggl Track API token, from Profile settings in Toggl.")
			.addComponent((el) =>
				new SecretComponent(this.app, el)
					.setValue(this.plugin.settings.tokenSecret)
					.onChange(async (value) => {
						this.plugin.settings.tokenSecret = value ?? "";
						await this.plugin.saveSettings();
					}),
			);

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
					.setPlaceholder("https://192.168.1.65:5173/api/selected-tags")
					.setValue(this.plugin.settings.tagsUrl)
					.onChange(async (value) => {
						this.plugin.settings.tagsUrl = value.trim();
						await this.plugin.saveSettings();
					}),
			);
	}
}
