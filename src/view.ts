import { ItemView, setIcon, WorkspaceLeaf } from "obsidian";
import type { Project } from "./main";
import type { TimeEntry } from "./toggl";

export const VIEW_TYPE_RUNNING = "toggl-tasks-running";

/** `/me` requests are capped at 30 per hour per user, shared with other Toggl clients. */
const POLL_MS = 5 * 60_000;

export interface RunningTimerSource {
	current(): Promise<TimeEntry | null>;
	/** Updates tracked time in the note last open in the editor. */
	syncNote(): Promise<void>;
	/** Starts a project timer for the note last open in the editor. */
	startNote(): Promise<void>;
	projectName(id: number): Promise<string | null>;
	/** Projects pinned in Toggl, from the projects file. */
	pinnedProjects(): Promise<Project[]>;
	/** Starts a timer with only a project. */
	startProject(project: Project): Promise<void>;
}

/**
 * The running Toggl timer. Polls only while visible and Obsidian is focused;
 * the elapsed time ticks locally in between.
 */
export class RunningTimerView extends ItemView {
	private entry: TimeEntry | null = null;
	private project: string | null = null;
	private pinned: Project[] = [];
	private error: string | null = null;
	private checkedAt = 0;
	private elapsedEl: HTMLElement | null = null;

	constructor(
		leaf: WorkspaceLeaf,
		private readonly source: RunningTimerSource,
	) {
		super(leaf);
	}

	getViewType(): string {
		return VIEW_TYPE_RUNNING;
	}

	getDisplayText(): string {
		return "Running timer";
	}

	getIcon(): string {
		return "timer";
	}

	async onOpen(): Promise<void> {
		this.registerInterval(window.setInterval(() => this.tick(), 1000));
		this.registerInterval(
			window.setInterval(() => {
				if (this.containerEl.isShown() && document.hasFocus()) void this.refresh();
			}, POLL_MS),
		);
		await this.refresh();
	}

	async refresh(): Promise<void> {
		try {
			// A local file read, so the list follows a rerun of the projects script.
			this.pinned = await this.source.pinnedProjects();
			await this.show(await this.source.current());
			this.error = null;
		} catch (e) {
			this.error = e instanceof Error ? e.message : String(e);
			this.render();
		}
	}

	/** Shows an entry already known, e.g. one just started, without a request. */
	async show(entry: TimeEntry | null): Promise<void> {
		this.entry = entry && entry.duration < 0 ? entry : null;
		this.project = this.entry?.project_id
			? await this.source.projectName(this.entry.project_id)
			: null;
		this.checkedAt = Date.now();
		this.render();
	}

	private render(): void {
		const root = this.contentEl;
		root.empty();
		root.addClass("toggl-tasks-running");

		if (this.entry) {
			root.createDiv({
				cls: "toggl-tasks-running-description",
				text: this.entry.description || "(no description)",
			});
			root.createDiv({
				cls: "toggl-tasks-running-project",
				text: this.project ?? "no project",
			});
			this.elapsedEl = root.createDiv({ cls: "toggl-tasks-running-elapsed" });
			this.tick();
		} else {
			this.elapsedEl = null;
			root.createDiv({ cls: "toggl-tasks-running-empty", text: "No timer running" });
		}

		const footer = root.createDiv({ cls: "toggl-tasks-running-footer" });
		footer.createSpan({
			text: this.error
				? `Error: ${this.error}`
				: `Checked ${new Date(this.checkedAt).toLocaleTimeString()}`,
		});
		const buttons = footer.createDiv({ cls: "toggl-tasks-running-buttons" });
		buttons
			.createEl("button", { text: "Start note" })
			.addEventListener("click", () => void this.source.startNote());
		buttons
			.createEl("button", { text: "Sync note" })
			.addEventListener("click", () => void this.source.syncNote());
		buttons
			.createEl("button", { text: "Refresh" })
			.addEventListener("click", () => void this.refresh());

		if (this.pinned.length) {
			const list = root.createDiv({ cls: "toggl-tasks-pinned" });
			for (const project of this.pinned) {
				const row = list.createDiv({
					cls: "toggl-tasks-pinned-project",
					attr: { "aria-label": `Start Toggl timer in ${project.name}`, role: "button" },
				});
				setIcon(row.createSpan({ cls: "toggl-tasks-start-icon" }), "power");
				row.createSpan({ text: project.name });
				row.addEventListener("click", () => void this.source.startProject(project));
			}
		}
	}

	private tick(): void {
		if (!this.entry || !this.elapsedEl) return;
		const s = Math.max(0, Math.floor((Date.now() - Date.parse(this.entry.start)) / 1000));
		const pad = (n: number) => String(n).padStart(2, "0");
		this.elapsedEl.setText(
			`${Math.floor(s / 3600)}:${pad(Math.floor(s / 60) % 60)}:${pad(s % 60)}`,
		);
	}
}
