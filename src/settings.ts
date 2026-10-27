import { App, PluginSettingTab, Setting } from "obsidian";
import type TogglTasksPlugin from "./main";

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

export class TogglTasksSettingTab extends PluginSettingTab {
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
					.setPlaceholder("http://tags.lan/api/selected-tags")
					.setValue(this.plugin.settings.tagsUrl)
					.onChange(async (value) => {
						this.plugin.settings.tagsUrl = value.trim();
						await this.plugin.saveSettings();
					}),
			);

		new Setting(containerEl)
			.setName("Priority tags file")
			.setDesc(
				'Optional. Vault path of a JSON file mapping tag names such as "p:high ⏫" to ids, added for the task\'s priority emoji.',
			)
			.addText((text) =>
				text
					.setPlaceholder("scripts/toggl-priority-tags.json")
					.setValue(this.plugin.settings.priorityTagsPath)
					.onChange(async (value) => {
						this.plugin.settings.priorityTagsPath = value.trim();
						await this.plugin.saveSettings();
					}),
			);
	}
}
