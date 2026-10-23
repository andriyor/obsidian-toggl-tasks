# Toggl Tasks

Obsidian plugin that starts [Toggl Track](https://toggl.com/track/) timers from task lines and writes the tracked time back into the note.

Toggl stays the source of truth: timers are stopped in Toggl (app, web, Lock Screen), and the plugin reads the totals back from the Toggl API.

Desktop only.

## Start a timer

Press the **▶** pill at the end of an open task (Live Preview and source mode), or run **Start timer for task on current line**.

| Timer field | Comes from                                                                                          |
| ----------- | --------------------------------------------------------------------------------------------------- |
| Description | The task text without Tasks metadata (dates, priority, recurrence, `🆔`), `#tags` and link brackets |
| Project     | The note's `toggl_project` property, looked up by name in the projects file                         |
| Tags        | Tag ids returned by the tags URL, if set                                                            |
| Toggl task  | `[toggl_task:: <project id>/<task id>]` in the line, created on the first start                     |

On the **first start** of a task:

1. If the note has no `toggl_project`, you pick a project from the list. The choice is saved as the note's `toggl_project`, so other tasks in the note don't ask again. Esc starts the timer without a project and saves nothing; such a task has no Toggl task, so its time is not synced to the note.
2. With a project, the plugin creates a **Toggl task** (Starter plan or higher) named after the task and writes its reference into the line:

   ```md
   - [ ] write docs [toggl_task:: 222884173/244297613] 📅 2026-10-20
   ```

Later starts reuse that reference and don't ask for anything.

## Tracked time

Run **Update tracked time in current note**, or press **Sync note** in the sidebar. It writes:

- each task's total as an inline field, before its Tasks metadata so Tasks still reads the dates:

  ```md
  - [ ] write docs [toggl:: 1:15] [toggl_task:: 222884173/244297613] 📅 2026-10-20
  ```

- the sum for the note as the `toggl_hours` property, e.g. `toggl_hours: 3.5`

Totals come from the tasks' Toggl tasks: one request per project, all time, and renaming a task keeps its time. Tasks without a Toggl task are left as they are.

Totals under a minute are not written, and a running timer is counted only after it stops.

## Running timer

The ribbon icon or **Show running timer** opens a sidebar view with the running timer's description, project and elapsed time, plus **Sync note** and **Refresh** buttons.

- A timer started with ▶ shows up immediately.
- Otherwise the view polls `/me/time_entries/current` every 5 minutes, only while it is visible and Obsidian is focused: `/me` requests are limited to 30 per hour per user. A timer stopped in the Toggl app can take up to 5 minutes to disappear, or press **Refresh**.

## Settings

| Setting       | Description                                                                                                     |
| ------------- | --------------------------------------------------------------------------------------------------------------- |
| API token     | Not a setting: read from `TOGGL_API_TOKEN=...` in `.env` at the vault root. Keep that file out of git.          |
| Projects file | Vault path of a JSON file `{ "project name": id }`                                                              |
| Tags URL      | Optional. Returns `[{ "id": 123 }, …]`. Self-signed HTTPS certificates are accepted, so it can be a LAN server. |

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
