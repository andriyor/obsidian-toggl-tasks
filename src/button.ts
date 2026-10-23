import { RangeSetBuilder } from "@codemirror/state";
import {
	Decoration,
	DecorationSet,
	EditorView,
	ViewPlugin,
	ViewUpdate,
	WidgetType,
} from "@codemirror/view";
import { setIcon } from "obsidian";
import { parseTask } from "./task";

/** Called with the clicked task line; the editor resolves which note it is in. */
export type StartHandler = (view: EditorView, line: string) => void;

class PlayWidget extends WidgetType {
	constructor(
		private readonly lineFrom: number,
		private readonly time: string | null,
		private readonly onStart: StartHandler,
	) {
		super();
	}

	eq(other: PlayWidget): boolean {
		return other.lineFrom === this.lineFrom && other.time === this.time;
	}

	toDOM(view: EditorView): HTMLElement {
		const button = createSpan({
			cls: "toggl-tasks-start",
			attr: { "aria-label": "Start Toggl timer", role: "button" },
		});
		setIcon(button.createSpan({ cls: "toggl-tasks-start-icon" }), "play");
		if (this.time) button.createSpan({ text: this.time });
		// mousedown, not click: keeps the cursor where it is.
		button.addEventListener("mousedown", (e) => {
			e.preventDefault();
			e.stopPropagation();
			this.onStart(view, view.state.doc.lineAt(this.lineFrom).text);
		});
		return button;
	}

	ignoreEvent(): boolean {
		return true;
	}
}

/** ▶ at the end of every open task line in the visible part of the editor. */
export function startButtons(onStart: StartHandler) {
	const build = (view: EditorView): DecorationSet => {
		const builder = new RangeSetBuilder<Decoration>();
		for (const { from, to } of view.visibleRanges) {
			for (let pos = from; pos <= to;) {
				const line = view.state.doc.lineAt(pos);
				const task = parseTask(line.text);
				if (task && !task.done && task.description) {
					builder.add(
						line.to,
						line.to,
						Decoration.widget({
							widget: new PlayWidget(line.from, task.time, onStart),
							side: 1,
						}),
					);
				}
				pos = line.to + 1;
			}
		}
		return builder.finish();
	};

	return ViewPlugin.fromClass(
		class {
			decorations: DecorationSet;
			constructor(view: EditorView) {
				this.decorations = build(view);
			}
			update(update: ViewUpdate) {
				if (update.docChanged || update.viewportChanged)
					this.decorations = build(update.view);
			}
		},
		{ decorations: (v) => v.decorations },
	);
}
