import { requestUrl } from "obsidian";

/** Tag ids from a URL returning `[{ id }]`; empty when unset or unreachable. */
export async function fetchTagIds(url: string): Promise<number[]> {
	if (!url) return [];
	try {
		const res = await requestUrl({ url, throw: false });
		return (res.json as { id: number }[]).map((t) => t.id);
	} catch {
		return [];
	}
}
