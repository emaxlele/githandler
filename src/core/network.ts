/**
 * Avanzamento delle operazioni di rete, letto da `stderr` di Git.
 *
 * Git scrive le righe di avanzamento su `stderr` con `\r` quando non c'è un terminale: un lettore
 * che accumula i pezzi e divide su `\r`/`\n` trasforma gli aggiornamenti in eventi. Il parser è puro,
 * così i casi (percentuale, dettaglio, righe senza avanzamento) si provano senza rete.
 */
export interface NetworkProgress {
	/** Nome del passo come lo scrive Git: `Receiving objects`, `Resolving deltas`… */
	phase: string;
	/** Percentuale intera fra 0 e 100. */
	percent: number;
	/** Parte dopo la percentuale: conteggio e velocità, mostrata come dettaglio. */
	detail: string;
}

/**
 * Una riga di avanzamento; `null` per tutto il resto (messaggi `remote:`, avvisi, righe vuote).
 * Il prefisso `remote:` viene tolto: è lo stesso passo, solo eseguito dall'altro capo.
 */
export function parseProgressLine(line: string): NetworkProgress | null {
	let text = line.replace(/\u001b\[[0-9;]*m/g, "").trim();
	if (!text) return null;
	if (text.startsWith("remote: "))
		text = text.slice("remote: ".length).trim();
	const match = /^(.+?):\s*(\d{1,3})%(?:\s*\(([^)]*)\))?(?:,\s*(.*))?$/.exec(
		text
	);
	if (!match) return null;
	const percent = Number.parseInt(match[2]!, 10);
	if (!Number.isFinite(percent)) return null;
	return {
		phase: match[1]!.trim(),
		percent: Math.min(100, Math.max(0, percent)),
		detail: [match[3], match[4]]
			.filter((part): part is string => Boolean(part && part.trim()))
			.join(" · "),
	};
}

/**
 * Accumula i pezzi di `stderr` e chiama `onProgress` per ogni riga completa.
 *
 * Git aggiorna la stessa riga con `\r`: il pezzo finale resta nel buffer finché non arriva un
 * separatore o `end()`. Il buffer è limitato: un output patologico non deve crescere senza fine.
 */
export class ProgressReader {
	#buffer = "";
	readonly #onProgress: (progress: NetworkProgress) => void;

	constructor(onProgress: (progress: NetworkProgress) => void) {
		this.#onProgress = onProgress;
	}

	push(chunk: string): void {
		this.#buffer += chunk;
		const parts = this.#buffer.split(/[\r\n]/);
		this.#buffer = parts.pop() ?? "";
		for (const part of parts) this.#emit(part);
		if (this.#buffer.length > 16_384)
			this.#buffer = this.#buffer.slice(-4096);
	}

	end(): void {
		if (this.#buffer) this.#emit(this.#buffer);
		this.#buffer = "";
	}

	#emit(line: string): void {
		const progress = parseProgressLine(line);
		if (progress) this.#onProgress(progress);
	}
}
