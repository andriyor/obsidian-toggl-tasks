import { App, PluginSettingTab, SettingDefinitionItem } from "obsidian";
import { AskedItem, askedList } from "./asked";
import type TogglTasksPlugin from "./main";

/** Vault-root file with `TOGGL_API_TOKEN=...`; keep it out of git. */
export const ENV_FILE = ".env";
/** Note property naming the Toggl project for its tasks. */
export const PROJECT_PROPERTY = "toggl_project";

export interface Settings {
	/** `{ "project name": { id, pinned } }`, written by "Update projects from Toggl". */
	projects: Record<string, { id: number; pinned: boolean }>;
	/** Ids of pinned projects in the order the running timer view lists them. */
	pinnedOrder: number[];
	/** URL returning `[{ id }]` of tags to attach to every new timer. */
	tagsUrl: string;
	/** `{ "tag name": id }`, written by "Update tags from Toggl". */
	tags: Record<string, number>;
	/** Categories and tags to pick from before a timer starts, in picker order. */
	askedItems: AskedItem[];
	/** Tag id → description shown under the tag in the picker. */
	tagDescs: Record<number, string>;
}

export const DEFAULT_SETTINGS: Settings = {
	projects: {},
	pinnedOrder: [],
	tagsUrl: "",
	tags: {},
	askedItems: [],
	tagDescs: {},
};

/** Control key of a tag's description, followed by the tag id. */
const DESC_KEY = "asked-desc:";

/** Declarative, so the settings show up in Obsidian's settings search. */
export class TogglTasksSettingTab extends PluginSettingTab {
	constructor(
		app: App,
		private readonly plugin: TogglTasksPlugin,
	) {
		super(app, plugin);
	}

	getControlValue(key: string): unknown {
		if (!key.startsWith(DESC_KEY)) return super.getControlValue(key);
		return this.plugin.settings.tagDescs[Number(key.slice(DESC_KEY.length))] ?? "";
	}

	setControlValue(key: string, value: unknown): void | Promise<void> {
		if (!key.startsWith(DESC_KEY)) return super.setControlValue(key, value);
		return this.plugin.setTagDesc(Number(key.slice(DESC_KEY.length)), String(value));
	}

	getSettingDefinitions(): SettingDefinitionItem[] {
		return [
			{
				name: "API token",
				desc: `Read from TOGGL_API_TOKEN in ${ENV_FILE} at the vault root.`,
				render: (setting) => {
					setting.addButton((button) =>
						button.setButtonText("Check").onClick(() => void this.plugin.checkToken()),
					);
				},
			},
			{
				name: "Update projects from Toggl",
				desc: `${this.projectCount()} Click, or run the command of the same name, after changing projects in Toggl. A note's "${PROJECT_PROPERTY}" property picks one; otherwise you choose when starting. Pinned projects are listed in the running timer view.`,
				action: () => void this.plugin.updateProjects().then(() => this.update()),
			},
			{
				type: "list",
				heading: "Pinned projects",
				emptyState: "Pin projects in Toggl, then update projects from Toggl.",
				items: this.plugin.pinnedProjects().map((p) => ({ name: p.name })),
				onReorder: (from, to) =>
					void this.plugin.movePinnedProject(from, to).then(() => this.update()),
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
				name: "Update tags from Toggl",
				desc: `${Object.keys(this.plugin.settings.tags).length} tags. Click, or run the command of the same name, after changing tags in Toggl.`,
				action: () => void this.plugin.updateTags().then(() => this.update()),
			},
			{
				type: "list",
				heading: "Asked tags",
				emptyState:
					"Add categories, such as p for p:high and p:low, or single tags to pick from before a timer starts.",
				items: askedList(this.plugin.settings.tags, this.plugin.settings.askedItems).map(
					({ label }) => ({ name: label }),
				),
				addItem: {
					name: "Add category or tag",
					action: () => void this.plugin.addAskedItem().then(() => this.update()),
				},
				onReorder: (from, to) =>
					void this.plugin.moveAskedItem(from, to).then(() => this.update()),
				onDelete: (index) =>
					void this.plugin.removeAskedItem(index).then(() => this.update()),
			},
			{
				type: "group",
				heading: "Tag descriptions",
				cls: "toggl-tasks-descriptions",
				items: this.plugin.askedTags().map((tag) => ({
					name: tag.name,
					control: {
						type: "text",
						key: `${DESC_KEY}${tag.id}`,
						placeholder: "Shown in the picker",
					},
				})),
			},
		];
	}

	private projectCount(): string {
		const projects = Object.values(this.plugin.settings.projects);
		const pinned = projects.filter((p) => p.pinned).length;
		return `${projects.length} projects, ${pinned} pinned.`;
	}
}
