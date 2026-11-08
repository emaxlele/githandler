import { canStagePartially, type PatchMode } from "../core/patch.ts";
import type { DiffFile } from "../core/types.ts";
import { escapeHtml } from "./dom.ts";

function statusLabel(file: DiffFile): string {
	switch (file.status) {
		case "added":
			return "nuovo";
		case "deleted":
			return "eliminato";
		case "renamed":
			return `rinominato${file.oldPath ? ` da ${file.oldPath}` : ""}`;
		case "copied":
			return "copiato";
		case "typechange":
			return "tipo cambiato";
		case "binary":
			return "binario";
		default:
			return "modificato";
	}
}

function markers(line: { oldNo: number | null; newNo: number | null }): string {
	return `<span class="no">${line.oldNo ?? ""}</span><span class="no">${
		line.newNo ?? ""
	}</span>`;
}

export interface DiffRenderOptions {
	/** Lato del working tree su cui si può agire. Assente = diff in sola lettura. */
	mode?: PatchMode;
	/** Righe selezionate, nella forma `hunk:line`. */
	picked?: ReadonlySet<string>;
}

export function pickKey(hunk: number, line: number): string {
	return `${hunk}:${line}`;
}

/**
 * Disegna un unified diff con numerazione di riga.
 *
 * Costruisce una stringa HTML invece di migliaia di nodi: su un diff da 3.000 righe la differenza
 * fra `innerHTML` e `appendChild` per riga è misurabile in centinaia di millisecondi.
 *
 * Con `options.mode` il diff diventa operativo: ogni hunk ha i pulsanti per lo staging parziale e
 * le righe `+`/`-` si possono selezionare cliccando il numero di riga. Gli eventi sono delegati:
 * qui si emettono solo `data-*`, la gestione sta in `app.ts`.
 */
export function renderDiff(
	container: HTMLElement,
	file: DiffFile | null,
	emptyText: string,
	options: DiffRenderOptions = {}
): void {
	if (!file) {
		container.innerHTML = `<div class="empty-small">${escapeHtml(
			emptyText
		)}</div>`;
		return;
	}

	const head =
		`<div class="diff-head">` +
		`<span class="path">${escapeHtml(file.path)}</span>` +
		`<span class="muted">${escapeHtml(statusLabel(file))}</span>` +
		`<span class="stats">` +
		(file.additions
			? `<span style="color:var(--add-fg)">+${file.additions}</span> `
			: "") +
		(file.deletions
			? `<span style="color:var(--del-fg)">−${file.deletions}</span>`
			: "") +
		`</span></div>`;

	if (file.binary) {
		container.innerHTML = `${head}<div class="binary-note">File binario: nessuna anteprima testuale.</div>`;
		return;
	}

	if (file.hunks.length === 0) {
		container.innerHTML = `${head}<div class="binary-note">Nessuna differenza testuale.</div>`;
		return;
	}

	const mode =
		options.mode && canStagePartially(file) ? options.mode : undefined;
	const picked = options.picked ?? new Set<string>();
	const verb = mode === "unstage" ? "Unstage" : "Stage";

	const out: string[] = [head];
	file.hunks.forEach((hunk, hunkIndex) => {
		const header = `@@ -${hunk.oldStart},${hunk.oldLines} +${
			hunk.newStart
		},${hunk.newLines} @@${hunk.header ? ` ${hunk.header}` : ""}`;

		const pickedHere = countPicked(picked, hunkIndex);
		const actions = mode
			? `<span class="hunk-actions">` +
			  (pickedHere > 0
					? `<button class="icon-btn" data-act="${mode}-lines" data-hunk="${hunkIndex}">${verb} ${pickedHere} ${
							pickedHere === 1 ? "riga" : "righe"
					  }</button>`
					: "") +
			  `<button class="icon-btn" data-act="${mode}-hunk" data-hunk="${hunkIndex}">${verb} hunk</button>` +
			  `</span>`
			: "";

		out.push(
			`<div class="hunk-header"><span class="hunk-info">${escapeHtml(
				header
			)}</span>${actions}</div>`
		);

		hunk.lines.forEach((line, lineIndex) => {
			const cls =
				line.type === "add"
					? "add"
					: line.type === "del"
					? "del"
					: line.type === "nonewline"
					? "nonewline"
					: "ctx";
			const mark =
				line.type === "add"
					? "+"
					: line.type === "del"
					? "-"
					: line.type === "nonewline"
					? "\\"
					: " ";

			const selectable =
				mode !== undefined &&
				(line.type === "add" || line.type === "del");
			const key = pickKey(hunkIndex, lineIndex);
			const isPicked = selectable && picked.has(key);

			const attrs = selectable
				? ` data-hunk="${hunkIndex}" data-line="${lineIndex}" data-selectable="1"`
				: "";
			const pickClass = isPicked ? " is-picked" : "";

			out.push(
				`<div class="dline ${cls}${pickClass}"${attrs}>${markers(
					line
				)}<span class="mk">${mark}</span><span class="tx">${escapeHtml(
					line.text
				)}</span></div>`
			);
		});
	});

	container.innerHTML = out.join("");
}

function countPicked(picked: ReadonlySet<string>, hunk: number): number {
	let count = 0;
	for (const key of picked) if (key.startsWith(`${hunk}:`)) count++;
	return count;
}
