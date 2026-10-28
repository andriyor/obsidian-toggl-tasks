import { PluginSettingTab, SettingDefinitionItem, TFile } from "obsidian";

/** Vault-root file with `TOGGL_API_TOKEN=...`; keep it out of git. */
export const ENV_FILE = ".env";
/** Note property naming the Toggl project for its tasks. */
export const PROJECT_PROPERTY = "toggl_project";

export interface Settings {
	/** Vault path of a `{ "project name": id }` JSON file. */
	projectsPath: string;
	/** URL returning `[{ id }]` of tags to attach to every new timer. */
	tagsUrl: string;
	/** Vault path of a `{ "p:high ⏫": id, … }` JSON file for task priorities. */
	priorityTagsPath: string;
}

export const DEFAULT_SETTINGS: Settings = {
	projectsPath: "",
	tagsUrl: "",
	priorityTagsPath: "",
};

const isJson = (file: TFile): boolean => file.extension === "json";

/** Declarative, so the settings show up in Obsidian's settings search. */
export class TogglTasksSettingTab extends PluginSettingTab {
	getSettingDefinitions(): SettingDefinitionItem<keyof Settings>[] {
		return [
			{
				name: "API token",
				desc: `Read from TOGGL_API_TOKEN in ${ENV_FILE} at the vault root.`,
			},
			{
				name: "Projects file",
				desc: `Vault path of a JSON file mapping project names to ids. A note's "${PROJECT_PROPERTY}" property picks one; otherwise you choose when starting.`,
				control: {
					type: "file",
					key: "projectsPath",
					placeholder: "scripts/toggl-projects.json",
					filter: isJson,
				},
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
}
