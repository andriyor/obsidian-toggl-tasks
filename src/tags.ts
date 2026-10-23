// The tags endpoint is a LAN server with a self-signed certificate, which
// Obsidian's requestUrl rejects, so this request goes through Node directly.
import { get } from "https";

/** Tag ids from a URL returning `[{ id }]`; empty when unset or unreachable. */
export function fetchTagIds(url: string): Promise<number[]> {
	if (!url) return Promise.resolve([]);
	return new Promise((resolve) => {
		const req = get(url, { rejectUnauthorized: false, timeout: 3000 }, (res) => {
			let body = "";
			res.on("data", (chunk: string) => (body += chunk));
			res.on("end", () => {
				try {
					resolve((JSON.parse(body) as { id: number }[]).map((t) => t.id));
				} catch {
					resolve([]);
				}
			});
		});
		req.on("error", () => resolve([]));
		req.on("timeout", () => req.destroy());
	});
}
