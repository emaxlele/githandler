import type { Commit, GraphRow } from "../core/types.ts";
import {
	avatarColor,
	byId,
	clear,
	el,
	fullDate,
	initials,
	shortDate,
} from "./dom.ts";
import { t } from "./i18n.ts";

const ROW_H = 28;
const LANE_W = 12;
const OVERSCAN = 4;

const LANE_COLORS = [
	"#7aa2f7",
	"#bb9af7",
	"#9ece6a",
	"#e0af68",
	"#f7768e",
	"#7dcfff",
	"#c0caf5",
	"#ff9e64",
];

function laneColor(lane: number): string {
	return LANE_COLORS[lane % LANE_COLORS.length]!;
}

export interface LogViewOptions {
	onSelect: (sha: string) => void;
	/** Chiamato quando la finestra visibile arriva in fondo alla storia caricata. */
	onEndReached?: () => void;
}

/**
 * Lista dei commit virtualizzata: nel DOM esistono solo le righe visibili.
 * Il grafo è un SVG ridisegnato sulla finestra visibile, quindi il costo non cresce con la storia.
 */
export class LogView {
	#commits: Commit[] = [];
	#graph: GraphRow[] = [];
	#selected: string | null = null;
	#first = -1;
	#last = -1;
	#dirty = true;

	readonly #scroller = byId("log");
	readonly #spacer = byId("log-spacer");
	readonly #window = byId("log-window");
	readonly #rows = byId("log-rows");
	readonly #svg = byId("log-graph") as unknown as SVGSVGElement;
	readonly #empty = byId("log-empty");
	readonly #options: LogViewOptions;

	constructor(options: LogViewOptions) {
		this.#options = options;
		this.#scroller.addEventListener("scroll", () => this.#render(), {
			passive: true,
		});
		this.#rows.addEventListener("click", (event) => {
			const row = (event.target as HTMLElement).closest<HTMLElement>(
				".row"
			);
			if (!row?.dataset.sha) return;
			this.#selected = row.dataset.sha;
			this.#dirty = true;
			this.#render();
			this.#options.onSelect(row.dataset.sha);
		});
	}

	setData(commits: Commit[], graph: GraphRow[]): void {
		this.#commits = commits;
		this.#graph = graph;
		this.#dirty = true;
		this.#empty.classList.toggle("hidden", commits.length > 0);
		this.#render();
	}

	setEmptyMessage(text: string): void {
		this.#empty.textContent = text;
	}

	get selected(): string | null {
		return this.#selected;
	}

	select(sha: string | null): void {
		this.#selected = sha;
		this.#dirty = true;
		this.#render();
	}

	/** Porta un commit nella parte visibile e lo seleziona. */
	reveal(sha: string): void {
		const index = this.#commits.findIndex((commit) => commit.sha === sha);
		if (index < 0) return;
		const top = index * ROW_H;
		if (
			top < this.#scroller.scrollTop ||
			top > this.#scroller.scrollTop + this.#scroller.clientHeight - ROW_H
		) {
			this.#scroller.scrollTop = Math.max(
				0,
				top - this.#scroller.clientHeight / 2
			);
		}
	}

	/** Sposta la selezione di `delta` posizioni. */
	step(delta: number): void {
		if (this.#commits.length === 0) return;
		const current = this.#commits.findIndex(
			(commit) => commit.sha === this.#selected
		);
		const next = Math.min(
			this.#commits.length - 1,
			Math.max(0, (current < 0 ? 0 : current) + delta)
		);
		const sha = this.#commits[next]!.sha;
		this.#selected = sha;
		this.#dirty = true;
		this.reveal(sha);
		this.#render();
		this.#options.onSelect(sha);
	}

	#render(): void {
		const total = this.#commits.length;
		this.#spacer.style.height = `${total * ROW_H}px`;

		if (total === 0) {
			clear(this.#rows);
			this.#svg.innerHTML = "";
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

		// il fondo della storia caricata: si chiede la pagina successiva una volta sola
		if (total > 0 && last >= total - 10 && this.#options.onEndReached)
			this.#options.onEndReached();

		this.#window.style.transform = `translateY(${first * ROW_H}px)`;

		const lanes = this.#graph
			.slice(first, last)
			.reduce(
				(max, row) =>
					Math.max(
						max,
						row.lane + 1,
						row.before.length,
						row.after.length
					),
				1
			);
		const graphWidth = lanes * LANE_W + 8;
		this.#rows.style.setProperty("--graph-w", `${graphWidth}px`);

		clear(this.#rows);
		for (let i = first; i < last; i++) {
			this.#rows.appendChild(this.#buildRow(this.#commits[i]!));
		}

		this.#drawGraph(first, last, graphWidth);
	}

	#buildRow(commit: Commit): HTMLElement {
		const row = el("div", "row");
		row.dataset.sha = commit.sha;
		if (commit.sha === this.#selected) row.classList.add("is-selected");

		const subject = el("div", "row-subject");
		for (const ref of commit.refs) {
			const badge = el("span", `ref-badge k-${ref.kind}`, ref.label);
			badge.title = ref.kind === "head" ? "HEAD" : ref.kind;
			subject.appendChild(badge);
		}
		const message = el(
			"span",
			"msg",
			commit.subject || t("(nessun messaggio)")
		);
		message.title = commit.subject;
		subject.appendChild(message);

		const author = el("div", "row-author");
		author.title = `${commit.author} <${commit.email}>`;
		const avatar = el("span", "avatar", initials(commit.author));
		avatar.style.background = avatarColor(commit.author);
		author.append(avatar, el("span", "name", commit.author));

		const sha = el("div", "row-sha", commit.sha.slice(0, 8));

		const time = el("div", "row-time", shortDate(commit.timestamp * 1000));
		time.title = fullDate(commit.timestamp * 1000);

		row.append(subject, author, sha, time);
		return row;
	}

	#drawGraph(first: number, last: number, width: number): void {
		const height = (last - first) * ROW_H;
		const parts: string[] = [];
		const x = (lane: number): number => 6 + lane * LANE_W;

		for (let i = first; i < last; i++) {
			const row = this.#graph[i]!;
			const y0 = (i - first) * ROW_H;
			const cy = y0 + ROW_H / 2;

			for (let lane = 0; lane < row.before.length; lane++) {
				if (row.before[lane] === null || row.incoming.includes(lane))
					continue;
				parts.push(
					`<path d="M${x(lane)} ${y0}L${x(lane)} ${
						y0 + ROW_H
					}" stroke="${laneColor(lane)}"/>`
				);
			}

			for (const lane of row.incoming) {
				if (lane === row.lane) continue;
				parts.push(
					`<path d="M${x(lane)} ${y0}L${x(lane)} ${cy}L${x(
						row.lane
					)} ${cy}" stroke="${laneColor(lane)}"/>`
				);
			}

			if (row.before[row.lane] === row.sha) {
				parts.push(
					`<path d="M${x(row.lane)} ${y0}L${x(
						row.lane
					)} ${cy}" stroke="${laneColor(row.lane)}"/>`
				);
			}

			if (row.after[row.lane] != null) {
				parts.push(
					`<path d="M${x(row.lane)} ${cy}L${x(row.lane)} ${
						y0 + ROW_H
					}" stroke="${laneColor(row.lane)}"/>`
				);
			}

			for (const lane of row.outgoing) {
				parts.push(
					`<path d="M${x(row.lane)} ${cy}L${x(lane)} ${cy}L${x(
						lane
					)} ${y0 + ROW_H}" stroke="${laneColor(lane)}"/>`
				);
			}

			parts.push(
				`<circle cx="${x(
					row.lane
				)}" cy="${cy}" r="3.2" fill="${laneColor(
					row.lane
				)}" stroke="#0d1017" stroke-width="1"/>`
			);
		}

		this.#svg.setAttribute("width", String(width));
		this.#svg.setAttribute("height", String(height));
		this.#svg.innerHTML = `<g fill="none" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round">${parts.join(
			""
		)}</g>`;
	}
}
