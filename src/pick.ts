import { App, FuzzyMatch, FuzzySuggestModal } from "obsidian";

/** Fuzzy picker resolving to the chosen item, or null on Esc. */
export class PickModal<T> extends FuzzySuggestModal<T> {
	private resolve: (item: T | null) => void = () => {};

	/** `note` is an optional second line under an item; it is searched too. */
	constructor(
		app: App,
		private readonly items: T[],
		private readonly text: (item: T) => string,
		placeholder: string,
		private readonly note: (item: T) => string | undefined = () => undefined,
	) {
		super(app);
		this.setPlaceholder(placeholder);
	}

	choose(): Promise<T | null> {
		return new Promise((resolve) => {
			this.resolve = resolve;
			this.open();
		});
	}

	getItems(): T[] {
		return this.items;
	}

	getItemText(item: T): string {
		const note = this.note(item);
		return note ? `${this.text(item)} ${note}` : this.text(item);
	}

	renderSuggestion({ item }: FuzzyMatch<T>, el: HTMLElement): void {
		const note = this.note(item);
		if (!note) {
			el.setText(this.text(item));
			return;
		}
		// Obsidian's own two-line suggestion layout.
		el.addClass("mod-complex");
		const content = el.createDiv({ cls: "suggestion-content" });
		content.createDiv({ cls: "suggestion-title", text: this.text(item) });
		content.createDiv({ cls: "suggestion-note", text: note });
	}

	onChooseItem(item: T): void {
		this.resolve(item);
	}

	onClose(): void {
		// Runs before onChooseItem when an item is picked, so let that win.
		window.setTimeout(() => this.resolve(null), 0);
	}
}
