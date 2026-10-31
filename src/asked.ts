/** An entry of the asked list: a whole category, or one tag without a category. */
export type AskedItem = { group: string } | { id: number };

/** A tag to pick from before a timer starts. */
export interface NamedTag {
	id: number;
	name: string;
	/** Shown under the name in the picker, e.g. what counts as high. */
	desc?: string;
}

/** The part of a tag name before its first `:`, e.g. `p`; empty if it has none. */
export function category(name: string): string {
	const i = name.indexOf(":");
	return i < 0 ? "" : name.slice(0, i);
}

/** Note property with a category's tag; `p` keeps the name notes already use. */
export function categoryProperty(cat: string): string {
	if (cat === "p") return "toggl_priority";
	return cat ? `toggl_${cat}` : "toggl_tag";
}

/** Every entry that can be asked: categories, then tags without one. */
function askedChoices(
	tags: Record<string, number>,
): { item: AskedItem; label: string }[] {
	const names = Object.keys(tags).sort((a, b) => a.localeCompare(b));
	const sizes = new Map<string, number>();
	for (const name of names) {
		const cat = category(name);
		if (cat) sizes.set(cat, (sizes.get(cat) ?? 0) + 1);
	}
	return [
		...Array.from(sizes, ([group, size]) => ({
			item: { group },
			label: `${group} (${size} ${size === 1 ? "tag" : "tags"})`,
		})),
		...names
			.filter((name) => !category(name))
			.map((name) => ({ item: { id: tags[name] }, label: name })),
	];
}

const sameItem = (a: AskedItem, b: AskedItem): boolean =>
	"group" in a ? "group" in b && a.group === b.group : "id" in b && a.id === b.id;

/** The saved entries that still exist in Toggl, with labels, in list order. */
export function askedList(
	tags: Record<string, number>,
	asked: AskedItem[],
): { item: AskedItem; label: string }[] {
	const choices = askedChoices(tags);
	return asked.flatMap((item) => choices.filter((c) => sameItem(c.item, item)));
}

/** The entries not in the list yet. */
export function addableItems(
	tags: Record<string, number>,
	asked: AskedItem[],
): { item: AskedItem; label: string }[] {
	return askedChoices(tags).filter((c) => !asked.some((item) => sameItem(c.item, item)));
}

/**
 * The tags the list stands for, in list order. A category's tags go by id, so in
 * the order they were created in Toggl.
 */
export function askedTags(
	tags: Record<string, number>,
	asked: AskedItem[],
	descs: Record<number, string>,
): NamedTag[] {
	const all = Object.entries(tags)
		.map(([name, id]) => ({ name, id }))
		.sort((a, b) => a.id - b.id);
	return askedList(tags, asked)
		.flatMap(({ item }) =>
			all.filter((t) =>
				"group" in item ? category(t.name) === item.group : t.id === item.id,
			),
		)
		.map((t) => (descs[t.id] ? { ...t, desc: descs[t.id] } : t));
}

/** Asked tags per category, asked one category at a time in list order. */
export function askedGroups<T extends { name: string }>(tags: T[]): Map<string, T[]> {
	const groups = new Map<string, T[]>();
	for (const tag of tags) {
		const cat = category(tag.name);
		groups.set(cat, [...(groups.get(cat) ?? []), tag]);
	}
	return groups;
}

/**
 * `ids` without the `asked` tags and any other tag in their categories, so an
 * entry gets at most one tag per category.
 */
export function withoutAsked(
	ids: number[],
	tags: Record<string, number>,
	asked: NamedTag[],
): number[] {
	const askedIds = new Set(asked.map((t) => t.id));
	const cats = new Set(asked.map((t) => category(t.name)).filter(Boolean));
	const names = new Map(Object.entries(tags).map(([name, id]) => [id, name]));
	return ids.filter(
		(id) => !askedIds.has(id) && !cats.has(category(names.get(id) ?? "")),
	);
}
