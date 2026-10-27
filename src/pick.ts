import { App, FuzzySuggestModal } from "obsidian";

/** Fuzzy picker resolving to the chosen item, or null on Esc. */
export class PickModal<T> extends FuzzySuggestModal<T> {
	private resolve: (item: T | null) => void = () => {};

	constructor(
		app: App,
		private readonly items: T[],
		private readonly text: (item: T) => string,
		placeholder: string,
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
		return this.text(item);
	}

	onChooseItem(item: T): void {
		this.resolve(item);
	}

	onClose(): void {
		// Runs before onChooseItem when an item is picked, so let that win.
		window.setTimeout(() => this.resolve(null), 0);
	}
}
