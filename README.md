# Toggl Tasks

Obsidian plugin that starts [Toggl Track](https://toggl.com/track/) timers from task lines and writes the tracked time back into the note.

The note is the single place a task is written. Like the [Toggl Track browser extension](https://github.com/toggl/track-extension), which adds a timer button to tools such as GitHub and Jira, the plugin starts a timer from the task itself, so task and project names are never copied into Toggl by hand.

For time, Toggl stays the source of truth: timers are stopped in the Toggl apps, and the plugin reads the totals back from the Toggl API.

Desktop only, Obsidian 1.13 or later.

## Setup

| Setting            | Description                                                                                                                                                                                                     |
| ------------------ | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| API token          | Not a setting: read from `TOGGL_API_TOKEN=...` in `.env` at the vault root. Keep that file out of git.                                                                                                          |
| Tags URL           | Optional. Returns `[{ "id": 123 }, …]`.                                                                                                                                                                         |
| Priority tags file | Optional. Vault path of a JSON file `{ "p:highest 🔺": id, "p:high ⏫": id, "p:medium 🔼": id, "p:low 🔽": id, "p:lowest ⏬": id }`; a value can also be `{ "id": id, "desc": "…" }`, see [Priority](#priority) |

### Projects

Run **Update projects from Toggl**, from the command palette or by clicking it in the plugin settings, once, and again after adding, renaming or pinning projects in Toggl. It saves the active projects, sorted by name, with their ids and whether they are pinned, to the plugin's `data.json`.

## Start a timer

### For a task

Press the pink power button, like the Toggl Track extension's, at the end of an open task (Live Preview and source mode), or run **Start timer for task on current line**.

| Timer field | Comes from                                                                                                                                                                      |
| ----------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Description | The task text without Tasks metadata (dates, priority, recurrence, `🆔`), `#tags` and link brackets                                                                             |
| Project     | The note's `toggl_project` property, looked up by name in the projects (see [Projects](#projects))                                                                              |
| Tags        | Tag ids returned by the tags URL, if set, plus a priority tag (see [Priority](#priority)): 🔺 `p:highest 🔺`, ⏫ `p:high ⏫`, 🔼 `p:medium 🔼`, 🔽 `p:low 🔽`, ⏬ `p:lowest ⏬` |
| Toggl task  | `[toggl_task:: <project id>/<task id>]` in the line, created on the first start                                                                                                 |

On the **first start** of a task:

1. If the note has no `toggl_project`, you pick a project from the list. The choice is saved as the note's `toggl_project`, so other tasks in the note don't ask again. Esc starts the timer without a project and saves nothing; such a task has no Toggl task, so its time is not synced to the note.
2. With a project, the plugin creates a **Toggl task** (Starter plan or higher) named after the task and writes its reference into the line:

   ```md
   - [ ] write docs [toggl_task:: 1234567/7654321] 📅 2026-10-20
   ```

Later starts reuse that reference and don't ask for anything.

### Priority

With a priority tags file set, every timer gets at most one priority tag. Priority tags returned by the tags URL are dropped; the priority comes from:

1. The task's priority emoji, if it has one.
2. Otherwise the note's `toggl_priority` property, e.g. `toggl_priority: p:high ⏫`. This is also the priority of note timers.
3. Otherwise you pick one from the file's tags, and the choice is saved as `toggl_priority`. Pick **none** to save `toggl_priority: none`, so the note's timers get no priority tag and it doesn't ask again. Esc starts this timer without a priority and saves nothing.

A task without an emoji is "normal" in Tasks, but here it takes the note's priority instead.

To decide by your values rather than by urgency, give each tag a `desc`. The picker shows it under the tag name and searches it, so typing "health" finds the right level:

```json
{
	"p:highest 🔺": { "id": 1, "desc": "can't wait: a health problem, a deadline today" },
	"p:high ⏫": { "id": 2, "desc": "keeps life running: health, sleep, home, core work" },
	"p:medium 🔼": { "id": 3, "desc": "builds the long term: learning, reading" },
	"p:low 🔽": { "id": 4, "desc": "new and optional: side projects, exploring tools" },
	"p:lowest ⏬": { "id": 5, "desc": "only spends time: feeds, reels" }
}
```

### For a whole note

Press **Start note** in the running timer view or run **Start timer for current note**. It starts a timer in the note's project (picked and saved the same way) with the note title as description. The first start creates a Toggl task for the note and saves it as the note's `toggl_task` property, e.g. `toggl_task: 1234567/7654321`; later starts reuse it. Esc in the project list starts the timer without a project and saves nothing, so that time is not synced.

### For a pinned project

The running timer view lists the projects pinned in Toggl. Click one to start a timer with only that project: no description, Toggl task or priority tag, just the tags URL's tags. It is for time that has no note, like calls or eating, so it is not synced to any note.

## Tracked time

Run **Update tracked time in current note**, or press **Sync note** in the sidebar. It writes:

- each task's total as an inline field, before its Tasks metadata so Tasks still reads the dates:

  ```md
  - [ ] write docs [toggl:: 1:15] [toggl_task:: 1234567/7654321] 📅 2026-10-20
  ```

- the sum for the note, including the note's own `toggl_task`, as the `toggl_hours` property, e.g. `toggl_hours: 3.5`

Totals come from the tasks' Toggl tasks: one request per project, all time, and renaming a task keeps its time. Tasks without a Toggl task are left as they are.

Totals under a minute are not written, and a running timer is counted only after it stops.

## Running timer

The ribbon icon or **Show running timer** opens a sidebar view with the running timer's description, project and elapsed time, **Start note**, **Sync note** and **Refresh** buttons, and under them the [pinned projects](#for-a-pinned-project).

- A timer started from the plugin shows up immediately.
- Otherwise the view polls `/me/time_entries/current` every 5 minutes, only while it is visible and Obsidian is focused: `/me` requests are limited to 30 per hour per user. A timer stopped in the Toggl app can take up to 5 minutes to disappear, or press **Refresh**.

## Design decisions

- **Toggl is the source of truth, nothing is tracked locally.** Timers are often stopped outside Obsidian, in the Toggl apps, so a local timer would drift. This is also why this is not a fork of [Task Time Tracker](https://github.com/Mythanar/obsidian-task-time-tracker): it stores time locally and by design never calls an external API, and its codebase is large and changing its storage format.
- **Toggl tasks instead of matching by text.** Matching entries to tasks by description needs a Reports API request per task, is limited to 366 days per request, and breaks when a task is renamed. A Toggl task gives an id to store in the line and an all-time `tracked_seconds`, read for a whole project in one request. Tasks started without a project are therefore not synced.
- **The line stores both project and task id.** Toggl rejects a time entry with only `task_id` ("task needs to be in the same project as the time entry"), so `[toggl_task:: project/task]` keeps both and later starts need no lookup.
- **`tracked_seconds` is in milliseconds.** Despite the name, a 60 s entry reports `60000`; the plugin divides by 1000.
- **`toggl_hours` is a decimal number, not `h:mm`.** A number can be summed and compared in Dataview and Bases queries; an `h:mm` string cannot. Task lines use `h:mm` because they are read, not queried.
- **Inline fields go before Tasks metadata.** The Tasks plugin only parses emoji fields at the end of the line; appending `[toggl:: …]` after `📅 …` would turn the dates into description text.
- **Projects are saved in the plugin data, refreshed by a command.** Projects rarely change, and a local name → id map avoids an API call per start. `GET /me/projects` returns all of them unpaginated, unlike `/workspaces/{id}/projects`, which cuts off at the first page, and includes each project's `pinned`. A picked project is saved per note as `toggl_project`.
- **Priority is a tag.** Toggl time entries and tasks have no priority field. The tag is set when a timer starts, so an entry keeps the priority the task had while it was worked on, and reports can be filtered by it. Tags are created once in Toggl and mapped by name in a JSON file, like projects, so starting a timer needs no tag lookup.
- **Token in `.env`, not in plugin settings.** Plugin `data.json` can end up in git when a vault is versioned; `.env` stays out of it and can be shared with other Toggl scripts. Obsidian's secret storage is a todo.
- **The task reference is written through the open editor.** Writing it to the file on disk while the note has unsaved edits gets overwritten by the editor's next save; the line then has no reference, and the next start tries to create the same Toggl task again, which Toggl rejects with 400.
- **Running timer polls rarely.** `/me` requests are capped at 30 per hour per user across all Toggl clients, so the view polls every 5 minutes, only when visible and focused, and shows a just-started timer from the start response.

## Development

```sh
pnpm install
pnpm dev     # watch build
pnpm test
pnpm lint    # or lint:fix
pnpm check   # typecheck, lint, format check and tests
```

## Todo

- [ ] Optional token from Obsidian's secret storage (a `secret` control in the settings definitions + `app.secretStorage`), for vaults without a `.env`
- [ ] Running timer from the [toggl-lock](https://github.com/andriyor/toggl-lock) server instead of the Toggl API: its webhook-fed `state.display` (`{ message, project, startedAt }`) is current within seconds and polling it costs no Toggl quota. Needs a narrow `GET /display` route there (today only `GET /state`, which also exposes push tokens) and a URL + `APP_SECRET` setting here.
