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

/**
 * Disegna un unified diff con numerazione di riga.
 * Costruisce una stringa HTML invece di migliaia di nodi: su un diff da 3.000 righe la differenza
 * fra `innerHTML` e `appendChild` per riga è misurabile in centinaia di millisecondi.
 */
export function renderDiff(
	container: HTMLElement,
	file: DiffFile | null,
	emptyText: string
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

	const out: string[] = [head];
	for (const hunk of file.hunks) {
		const header = `@@ -${hunk.oldStart},${hunk.oldLines} +${
			hunk.newStart
		},${hunk.newLines} @@${hunk.header ? ` ${hunk.header}` : ""}`;
		out.push(`<div class="hunk-header">${escapeHtml(header)}</div>`);
		for (const line of hunk.lines) {
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
			out.push(
				`<div class="dline ${cls}">${markers(
					line
				)}<span class="mk">${mark}</span><span class="tx">${escapeHtml(
					line.text
				)}</span></div>`
			);
		}
	}

	container.innerHTML = out.join("");
}
