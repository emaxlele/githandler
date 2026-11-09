import { alignHunk, changedRanges, type AlignedRow } from "../core/align.ts";
import { canStagePartially, type PatchMode } from "../core/patch.ts";
import type { DiffFile, DiffHunk, DiffLine } from "../core/types.ts";
import { escapeHtml } from "./dom.ts";
import { t } from "./i18n.ts";

export type DiffLayout = "unified" | "split";

function statusLabel(file: DiffFile): string {
	switch (file.status) {
		case "added":
			return t("nuovo");
		case "deleted":
			return t("eliminato");
		case "renamed":
			return t(
				`rinominato${file.oldPath ? ` da ${file.oldPath}` : ""}`
			);
		case "copied":
			return t("copiato");
		case "typechange":
			return t("tipo cambiato");
		case "binary":
			return t("binario");
		default:
			return t("modificato");
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
	layout?: DiffLayout;
}

export function pickKey(hunk: number, line: number): string {
	return `${hunk}:${line}`;
}

function escapeWithHighlight(
	text: string,
	range: [number, number] | null
): string {
	if (!range) return escapeHtml(text);
	const [start, end] = range;
	if (end <= start) return escapeHtml(text);
	return (
		escapeHtml(text.slice(0, start)) +
		`<span class="hl">${escapeHtml(text.slice(start, end))}</span>` +
		escapeHtml(text.slice(end))
	);
}

/**
 * Disegna un diff con numerazione di riga, in due forme: `unified` (una colonna, come `git diff`) o
 * `split` (prima e dopo affiancati, con le modifiche accoppiate riga per riga).
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
	container.innerHTML = fileDiffHtml(file, options);
}

/**
 * Più file nello stesso riquadro, uno dopo l'altro come `git show`: ogni blocco tiene la sua
 * intestazione, che resta appiccicata in cima mentre si scorre. Serve al pannello Commit, dove il
 * commit si legge per intero invece di scegliere un file alla volta (quello è il File Tree).
 */
export function renderDiffs(
	container: HTMLElement,
	files: DiffFile[],
	emptyText: string,
	options: DiffRenderOptions = {}
): void {
	if (files.length === 0) {
		container.innerHTML = `<div class="empty-small">${escapeHtml(
			emptyText
		)}</div>`;
		return;
	}
	container.innerHTML = files
		.map((file) => fileDiffHtml(file, options))
		.join("");
}

/** HTML di un singolo file: intestazione, poi hunk oppure la nota per binari e file senza testo. */
export function fileDiffHtml(
	file: DiffFile,
	options: DiffRenderOptions = {}
): string {
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
		return `${head}<div class="binary-note">File binario: nessuna anteprima testuale.</div>`;
	}

	if (file.hunks.length === 0) {
		return `${head}<div class="binary-note">Nessuna differenza testuale.</div>`;
	}

	const mode =
		options.mode && canStagePartially(file) ? options.mode : undefined;
	const picked = options.picked ?? new Set<string>();
	const layout = options.layout ?? "unified";

	const body =
		layout === "split"
			? renderSplitBody(file, mode, picked)
			: renderUnifiedBody(file, mode, picked);

	return head + body;
}

function renderUnifiedBody(
	file: DiffFile,
	mode: PatchMode | undefined,
	picked: ReadonlySet<string>
): string {
	const out: string[] = [];
	file.hunks.forEach((hunk, hunkIndex) => {
		out.push(renderHunkHeader(hunk, hunkIndex, mode, picked));

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
	return out.join("");
}

function renderSplitBody(
	file: DiffFile,
	mode: PatchMode | undefined,
	picked: ReadonlySet<string>
): string {
	// Le due colonne hanno la stessa larghezza: si prende la riga più lunga del file, così le due
	// metà restano simmetriche invece di allargarsi una a scapito dell'altra.
	let widest = 0;
	for (const hunk of file.hunks) {
		for (const line of hunk.lines) widest = Math.max(widest, line.text.length);
	}
	const columns = Math.max(48, widest + 6);
	const out: string[] = [
		`<div class="split" style="--split-cols: ${columns}ch">`,
	];

	file.hunks.forEach((hunk, hunkIndex) => {
		out.push(renderHunkHeader(hunk, hunkIndex, mode, picked));

		for (const row of alignHunk(hunk)) {
			if (row.kind === "note") {
				out.push(
					`<div class="srow-note">${escapeHtml(row.line.text)}</div>`
				);
				continue;
			}

			const ranges =
				row.left && row.right
					? changedRanges(row.left.text, row.right.text)
					: null;

			out.push(
				`<div class="srow">${splitSide(
					row,
					"left",
					hunkIndex,
					mode,
					picked,
					ranges ? ranges.left : null
				)}${splitSide(
					row,
					"right",
					hunkIndex,
					mode,
					picked,
					ranges ? ranges.right : null
				)}</div>`
			);
		}
	});

	out.push("</div>");
	return out.join("");
}

function splitSide(
	row: Extract<AlignedRow, { kind: "pair" }>,
	side: "left" | "right",
	hunkIndex: number,
	mode: PatchMode | undefined,
	picked: ReadonlySet<string>,
	highlight: [number, number] | null
): string {
	const line: DiffLine | null = side === "left" ? row.left : row.right;
	const lineIndex = side === "left" ? row.leftIndex : row.rightIndex;

	if (!line) {
		return (
			`<span class="sc no ${side}"></span>` +
			`<span class="sc mk ${side}"></span>` +
			`<span class="sc tx ${side}"></span>`
		);
	}

	const kind =
		line.type === "add" ? "add" : line.type === "del" ? "del" : "ctx";
	const mark = line.type === "add" ? "+" : line.type === "del" ? "-" : " ";
	const number = side === "left" ? line.oldNo : line.newNo;

	const selectable =
		mode !== undefined &&
		lineIndex !== null &&
		(line.type === "add" || line.type === "del");
	const isPicked = selectable && picked.has(pickKey(hunkIndex, lineIndex!));
	const attrs = selectable
		? ` data-hunk="${hunkIndex}" data-line="${lineIndex}"`
		: "";
	const extra = isPicked ? " is-picked" : "";

	return (
		`<span class="sc no ${side} ${kind}${extra}"${attrs}>${
			number ?? ""
		}</span>` +
		`<span class="sc mk ${side} ${kind}${extra}"${attrs}>${mark}</span>` +
		`<span class="sc tx ${side} ${kind}${extra}"${attrs}>${escapeWithHighlight(
			line.text,
			highlight
		)}</span>`
	);
}

function renderHunkHeader(
	hunk: DiffHunk,
	hunkIndex: number,
	mode: PatchMode | undefined,
	picked: ReadonlySet<string>
): string {
	const header = `@@ -${hunk.oldStart},${hunk.oldLines} +${hunk.newStart},${
		hunk.newLines
	} @@${hunk.header ? ` ${hunk.header}` : ""}`;

	const pickedHere = countPicked(picked, hunkIndex);
	const verb = mode === "unstage" ? "Unstage" : "Stage";
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

	return `<div class="hunk-header"><span class="hunk-info">${escapeHtml(
		header
	)}</span>${actions}</div>`;
}

function countPicked(picked: ReadonlySet<string>, hunk: number): number {
	let count = 0;
	for (const key of picked) if (key.startsWith(`${hunk}:`)) count++;
	return count;
}
