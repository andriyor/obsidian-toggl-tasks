import { App, PluginSettingTab, SettingDefinitionItem, TFile } from "obsidian";
import type TogglTasksPlugin from "./main";

/** Vault-root file with `TOGGL_API_TOKEN=...`; keep it out of git. */
export const ENV_FILE = ".env";
/** Note property naming the Toggl project for its tasks. */
export const PROJECT_PROPERTY = "toggl_project";

export interface Settings {
	/** `{ "project name": { id, pinned } }`, written by "Update projects from Toggl". */
	projects: Record<string, { id: number; pinned: boolean }>;
	/** URL returning `[{ id }]` of tags to attach to every new timer. */
	tagsUrl: string;
	/** Vault path of a `{ "p:high ⏫": id, … }` JSON file for task priorities. */
	priorityTagsPath: string;
}

export const DEFAULT_SETTINGS: Settings = {
	projects: {},
	tagsUrl: "",
	priorityTagsPath: "",
};

const isJson = (file: TFile): boolean => file.extension === "json";

/** Declarative, so the settings show up in Obsidian's settings search. */
export class TogglTasksSettingTab extends PluginSettingTab {
	constructor(
		app: App,
		private readonly plugin: TogglTasksPlugin,
	) {
		super(app, plugin);
	}

	getSettingDefinitions(): SettingDefinitionItem<keyof Settings>[] {
		return [
			{
				name: "API token",
				desc: `Read from TOGGL_API_TOKEN in ${ENV_FILE} at the vault root.`,
			},
			{
				name: "Update projects from Toggl",
				desc: `${this.projectCount()} Click, or run the command of the same name, after changing projects in Toggl. A note's "${PROJECT_PROPERTY}" property picks one; otherwise you choose when starting. Pinned projects are listed in the running timer view.`,
				action: () => void this.plugin.updateProjects().then(() => this.update()),
			},
			{
				name: "Tags URL",
				desc: "Optional. Returns [{ id }] of tags added to every new timer.",
				control: {
					type: "text",
					key: "tagsUrl",
					placeholder: "http://tags.lan/api/selected-tags",
				},
			},
			{
				name: "Priority tags file",
				desc: 'Optional. Vault path of a JSON file mapping tag names such as "p:high ⏫" to ids, or to { id, desc } with a description shown when picking a note\'s priority.',
				control: {
					type: "file",
					key: "priorityTagsPath",
					placeholder: "scripts/toggl-priority-tags.json",
					filter: isJson,
				},
			},
		];
	}

	private projectCount(): string {
		const projects = Object.values(this.plugin.settings.projects);
		const pinned = projects.filter((p) => p.pinned).length;
		return `${projects.length} projects, ${pinned} pinned.`;
	}
}
