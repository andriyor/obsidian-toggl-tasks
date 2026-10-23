# Toggl Tasks

Obsidian plugin that starts a [Toggl Track](https://toggl.com/track/) timer from a task line and writes the tracked time back to the note. Toggl stays the source of truth: timers are stopped in Toggl, and the time is read back from its Reports API.

## Usage

- **▶ next to every open task** in the editor (Live Preview and source mode) starts a timer. The command **Start timer for task on current line** does the same for the line under the cursor.
  - Description: the task text without Tasks metadata (dates, priority, recurrence, `🆔`), `#tags` and link brackets.
  - Project: the note's `toggl_project` property, looked up by name in the projects file. Without it you pick one from the list, or press Esc for no project.
  - Tags: ids returned by the optional tags URL.
- **Update tracked time in current note** sums Toggl time per task over the last 366 days and writes it:
  - to the task as an inline field before its Tasks metadata: `- [ ] write docs [toggl:: 1:15] 📅 2026-10-20`
  - to the note as `toggl_hours: 3.5`
- **Running timer in the sidebar**: ribbon icon or **Show running timer**. Shows the description, project and elapsed time. It polls `/me/time_entries/current` every 5 minutes, only while the view is visible and Obsidian is focused, because `/me` requests are limited to 30 per hour per user. A timer started with ▶ shows up immediately; one stopped in the Toggl app can take up to 5 minutes, or press Refresh.

Tasks are matched to Toggl entries by exact description, so renaming a task starts a new total. The same task text in two notes counts the same entries in both.

## Settings

- **API token**: not a setting; read from `TOGGL_API_TOKEN=...` in `.env` at the vault root. Keep that file out of git.
- **Projects file**: vault path of a JSON file `{ "project name": id }`.
- **Tags URL**: optional, returns `[{ "id": 123 }, …]`. Self-signed HTTPS certificates are accepted, so it can be a LAN server.

Desktop only (the tags request uses Node's `https`).

## Todo

- [ ] Optional token from Obsidian's secret storage (`SecretComponent` + `app.secretStorage`, Obsidian 1.11.4+), for vaults without a `.env`
- [ ] Running timer from the [toggl-lock](https://github.com/andriyor/toggl-lock) server instead of the Toggl API: its webhook-fed `state.display` (`{ message, project, startedAt }`) is current within seconds and polling it costs no Toggl quota. Needs a narrow `GET /display` route there (today only `GET /state`, which also exposes push tokens) and a URL + `APP_SECRET` setting here.

## Development

```sh
pnpm install
pnpm dev     # watch build
pnpm test
pnpm lint
```
