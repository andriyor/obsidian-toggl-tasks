import { requestUrl } from "obsidian";

const API = "https://api.track.toggl.com/api/v9";
const REPORTS = "https://api.track.toggl.com/reports/api/v3";

interface DetailedRow {
	description: string;
	time_entries: { seconds: number }[];
}

export class Toggl {
	private workspaceId: number | null = null;

	constructor(private readonly token: () => string | null) {}

	private headers(): Record<string, string> {
		const token = this.token();
		if (!token) throw new Error("Toggl API token is not set");
		return {
			Authorization: "Basic " + btoa(`${token}:api_token`),
			"Content-Type": "application/json",
		};
	}

	private async workspace(): Promise<number> {
		if (this.workspaceId === null) {
			const me = await requestUrl({ url: `${API}/me`, headers: this.headers() });
			this.workspaceId = (
				me.json as { default_workspace_id: number }
			).default_workspace_id;
		}
		return this.workspaceId;
	}

	async start(
		description: string,
		projectId: number | null,
		tagIds: number[],
	): Promise<void> {
		const wid = await this.workspace();
		await requestUrl({
			url: `${API}/workspaces/${wid}/time_entries`,
			method: "POST",
			headers: this.headers(),
			body: JSON.stringify({
				created_with: "obsidian-toggl-tasks",
				workspace_id: wid,
				description,
				project_id: projectId ?? undefined,
				tag_ids: tagIds,
				start: new Date().toISOString(),
				duration: -1,
			}),
		});
	}

	/**
	 * Seconds tracked with exactly this description over the last 366 days.
	 * The reports filter is a case-insensitive substring match, so rows are
	 * compared exactly here. Running entries are not counted until stopped.
	 */
	// ponytail: 366 days is the Reports API maximum per request; walk earlier windows if older tasks matter
	async trackedSeconds(description: string): Promise<number> {
		const wid = await this.workspace();
		const end = new Date();
		const start = new Date(end.getTime() - 365 * 86_400_000);
		const day = (d: Date) => d.toISOString().slice(0, 10);
		let seconds = 0;
		let firstRow: number | undefined;
		do {
			const res = await requestUrl({
				url: `${REPORTS}/workspace/${wid}/search/time_entries`,
				method: "POST",
				headers: this.headers(),
				body: JSON.stringify({
					start_date: day(start),
					end_date: day(end),
					description,
					page_size: 50,
					first_row_number: firstRow,
				}),
			});
			for (const row of res.json as DetailedRow[]) {
				if (row.description === description) {
					for (const e of row.time_entries) seconds += e.seconds;
				}
			}
			const next = res.headers["x-next-row-number"] ?? res.headers["X-Next-Row-Number"];
			firstRow = next ? Number(next) : undefined;
		} while (firstRow);
		return seconds;
	}
}
