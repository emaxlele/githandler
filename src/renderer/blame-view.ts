import { UNCOMMITTED_SHA, type BlameFile } from "../core/blame.ts";
import { byId, clear, el, fullDate } from "./dom.ts";

const ROW_H = 20;
const OVERSCAN = 8;

const COMMIT_COLORS = [
	"#7aa2f7",
	"#9ece6a",
	"#e0af68",
	"#bb9af7",
	"#7dcfff",
	"#f7768e",
	"#ff9e64",
];

/**
 * Blame virtualizzato: per file da migliaia di righe restano nel DOM solo quelle visibili.
 * Il colore sulla sinistra identifica il commit, così i blocchi dello stesso autore si leggono a
 * colpo d'occhio senza raggruppare le righe (che falserebbe l'ordine del file).
 */
export class BlameView {
	#file: BlameFile | null = null;
	#first = -1;
	#last = -1;
	#dirty = true;
	#colors = new Map<string, string>();

	readonly #scroller = byId("blame-scroll");
	readonly #spacer = byId("blame-spacer");
	readonly #window = byId("blame-window");
	readonly #empty = byId("blame-empty");

	constructor() {
		this.#scroller.addEventListener("scroll", () => this.#render(), {
			passive: true,
		});
	}

	setData(file: BlameFile | null, message = ""): void {
		this.#file = file;
		this.#first = -1;
		this.#last = -1;
		this.#empty.textContent = message;
		this.#empty.classList.toggle("hidden", Boolean(file) && message === "");
		if (!file) {
			this.#spacer.style.height = "0px";
			clear(this.#window);
			return;
		}
		this.#colors = new Map();
		for (const line of file.lines) {
			if (line.commit === UNCOMMITTED_SHA) continue;
			if (!this.#colors.has(line.commit))
				this.#colors.set(
					line.commit,
					COMMIT_COLORS[this.#colors.size % COMMIT_COLORS.length]!
				);
		}
		this.#dirty = true;
		this.#render();
	}

	#render(): void {
		const file = this.#file;
		const total = file?.lines.length ?? 0;
		this.#spacer.style.height = `${total * ROW_H}px`;
		if (!file || total === 0) {
			clear(this.#window);
			return;
		}

		const scrollTop = this.#scroller.scrollTop;
		const height = this.#scroller.clientHeight || ROW_H * 20;
		const first = Math.max(0, Math.floor(scrollTop / ROW_H) - OVERSCAN);
		const last = Math.min(
			total,
			Math.ceil((scrollTop + height) / ROW_H) + OVERSCAN
		);
		if (!this.#dirty && first === this.#first && last === this.#last)
			return;
		this.#dirty = false;
		this.#first = first;
		this.#last = last;

		this.#window.style.transform = `translateY(${first * ROW_H}px)`;
		clear(this.#window);

		for (let i = first; i < last; i++) {
			const line = file.lines[i]!;
			const row = el("div", "blame-row");
			const uncommitted = line.commit === UNCOMMITTED_SHA;
			if (uncommitted) row.classList.add("is-local");

			const number = el("span", "blame-line", String(line.line));
			const sha = el(
				"span",
				"blame-sha",
				uncommitted ? "locale" : line.commit.slice(0, 7)
			);
			const author = el(
				"span",
				"blame-author",
				uncommitted ? "non committato" : line.author
			);
			const text = el("span", "blame-text", line.text);
			text.textContent = line.text;

			if (!uncommitted) {
				const color = this.#colors.get(line.commit) ?? "#7aa2f7";
				number.style.borderLeftColor = color;
				row.title = `${line.commit.slice(0, 10)}\n${
					line.author
				} — ${fullDate(line.timestamp * 1000)}\n${line.summary}`;
			} else {
				number.style.borderLeftColor = "#4b5563";
				row.title = "Righe non ancora committate";
			}

			row.append(number, sha, author, text);
			this.#window.appendChild(row);
		}
	}
}
