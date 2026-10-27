import { requestUrl, RequestUrlParam, RequestUrlResponse } from "obsidian";

const API = "https://api.track.toggl.com/api/v9";

/** `requestUrl` that puts Toggl's error text, e.g. why a 400 failed, in the error. */
async function request(params: RequestUrlParam): Promise<RequestUrlResponse> {
	const res = await requestUrl({ ...params, throw: false });
	if (res.status >= 400) throw new Error(`${res.status} ${res.text.trim()}`);
	return res;
}

/** A time entry as the v9 API returns it; running when `duration` is negative. */
export interface TimeEntry {
	description: string | null;
	project_id: number | null;
	start: string;
	duration: number;
}

interface ProjectTask {
	id: number;
	tracked_seconds: number;
}

export class Toggl {
	private workspaceId: number | null = null;

	constructor(private readonly token: () => Promise<string | null>) {}

	private async headers(): Promise<Record<string, string>> {
		const token = await this.token();
		if (!token) throw new Error("TOGGL_API_TOKEN is not set in .env");
		return {
			Authorization: "Basic " + btoa(`${token}:api_token`),
			"Content-Type": "application/json",
		};
	}

	private async workspace(): Promise<number> {
		if (this.workspaceId === null) {
			const me = await request({ url: `${API}/me`, headers: await this.headers() });
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
		taskId: number | null = null,
	): Promise<TimeEntry> {
		const wid = await this.workspace();
		const res = await request({
			url: `${API}/workspaces/${wid}/time_entries`,
			method: "POST",
			headers: await this.headers(),
			body: JSON.stringify({
				created_with: "obsidian-toggl-tasks",
				workspace_id: wid,
				description,
				project_id: projectId ?? undefined,
				task_id: taskId ?? undefined,
				tag_ids: tagIds,
				start: new Date().toISOString(),
				duration: -1,
			}),
		});
		return res.json as TimeEntry;
	}

	/** Creates a Toggl task (paid plans) in a project; returns its id. */
	async createTask(projectId: number, name: string): Promise<number> {
		const wid = await this.workspace();
		const res = await request({
			url: `${API}/workspaces/${wid}/projects/${projectId}/tasks`,
			method: "POST",
			headers: await this.headers(),
			body: JSON.stringify({ name }),
		});
		return (res.json as { id: number }).id;
	}

	/**
	 * All-time seconds per task id for one project, in a single request.
	 * Running entries are not counted until stopped.
	 */
	async projectTaskSeconds(projectId: number): Promise<Map<number, number>> {
		const wid = await this.workspace();
		const res = await request({
			url: `${API}/workspaces/${wid}/projects/${projectId}/tasks`,
			headers: await this.headers(),
		});
		const body = res.json as ProjectTask[] | { items: ProjectTask[] } | null;
		const tasks = Array.isArray(body) ? body : (body?.items ?? []);
		// tracked_seconds is in milliseconds despite its name (60 s entry → 60000).
		return new Map(tasks.map((t) => [t.id, Math.round(t.tracked_seconds / 1000)]));
	}

	/** The running entry, or null. A `/me` request: 30 per hour per user on every plan. */
	async current(): Promise<TimeEntry | null> {
		const res = await request({
			url: `${API}/me/time_entries/current`,
			headers: await this.headers(),
		});
		return (res.json as TimeEntry | null) ?? null;
	}
}
