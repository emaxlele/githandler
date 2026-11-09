/**
 * Rebase interattivo: la lista dei commit da riscrivere e il file che Git eseguirà.
 *
 * La regola è pura — azioni ammesse, ordine, messaggi — mentre il comando e i file temporanei
 * restano nel main. Il piano copre **tutti** i commit dell'intervallo scelto: un commit omesso
 * sparirebbe dalla storia, quindi è un errore, non una scorciatoia.
 */

import { assertSha } from "./ops.ts";

export type RebaseAction = "pick" | "reword" | "squash" | "fixup" | "drop";

const ACTIONS = new Set<RebaseAction>([
	"pick",
	"reword",
	"squash",
	"fixup",
	"drop",
]);

export interface RebaseCandidate {
	/** SHA completo del commit */
	sha: string;
	/** messaggio intero: oggetto, riga vuota e corpo */
	message: string;
}

export interface RebaseStep {
	/** SHA completo del commit */
	sha: string;
	action: RebaseAction;
	/** nuovo messaggio completo, obbligatorio per `reword` */
	message?: string;
}

/** Il primo passo utile: né `drop` né un commit che si fonde con quello prima. */
function firstKept(steps: RebaseStep[]): RebaseStep | undefined {
	return steps.find((step) => step.action !== "drop");
}

/** Controlli che valgono sia prima di eseguire sia nel test: nessun comando Git coinvolto. */
export function validateRebaseSteps(steps: RebaseStep[]): void {
	if (steps.length === 0)
		throw new Error("Il rebase non ha commit da riscrivere.");
	const seen = new Set<string>();
	for (const step of steps) {
		assertSha(step.sha);
		if (!ACTIONS.has(step.action))
			throw new Error(`Azione di rebase non valida: ${step.action}`);
		if (seen.has(step.sha))
			throw new Error(
				`Il commit ${step.sha.slice(0, 8)} compare due volte.`
			);
		seen.add(step.sha);
		if (step.action === "reword" && !step.message?.trim())
			throw new Error(
				"Un commit da rinominare ha bisogno di un messaggio."
			);
	}
	const first = firstKept(steps);
	if (!first)
		throw new Error(
			"Almeno un commit deve restare: per eliminarli tutti usa il reset."
		);
	if (first.action === "squash" || first.action === "fixup")
		throw new Error(
			"Il primo commit non può essere squash o fixup: non c'è niente da unire."
		);

	let kept = false;
	for (const step of steps) {
		if (step.action === "drop") continue;
		if ((step.action === "squash" || step.action === "fixup") && !kept)
			throw new Error(
				"Il primo commit non può essere squash o fixup: non c'è niente da unire."
			);
		kept = true;
	}
}

/**
 * Il piano deve nominare esattamente i commit che Git riscriverebbe: né uno in meno (sparirebbe)
 * né uno in più (non appartiene all'intervallo).
 */
export function assertPlanCovers(
	steps: RebaseStep[],
	expected: string[]
): void {
	validateRebaseSteps(steps);
	const planned = new Set(steps.map((step) => step.sha));
	if (expected.length !== planned.size)
		throw new Error(
			"Il piano non copre esattamente i commit da riscrivere: riapri la finestra."
		);
	for (const sha of expected) {
		if (!planned.has(sha))
			throw new Error(
				"Un commit dell'intervallo manca dal piano: riapri la finestra."
			);
	}
}

/** Virgolette per una riga `exec`: il percorso arriva solo da una cartella temporanea. */
function quotePath(path: string): string {
	return `"${path.replace(/["\\$`]/g, "\\$&")}"`;
}

/**
 * Il contenuto di `git-rebase-todo`. `drop` non compare (equivale a omettere la riga). Un
 * `reword` diventa `pick` più un `exec` che riscrive il messaggio: così non serve un editor
 * interattivo per ogni commit.
 */
export function rebaseTodo(
	steps: RebaseStep[],
	messagePath: (index: number) => string
): string {
	validateRebaseSteps(steps);
	const lines: string[] = [];
	steps.forEach((step, index) => {
		if (step.action === "drop") return;
		if (step.action === "reword") {
			lines.push(`pick ${step.sha}`);
			lines.push(
				`exec git commit --amend --no-verify -F ${quotePath(
					messagePath(index)
				)}`
			);
			return;
		}
		lines.push(`${step.action} ${step.sha}`);
	});
	return `${lines.join("\n")}\n`;
}

/** Argomenti di `git log` per l'intervallo da riscrivere, dal più vecchio al più recente. */
export function rebasePlanArgs(parent: string): string[] {
	assertSha(parent);
	return ["log", "--reverse", "--format=%H%x00%B%x1e", `${parent}..HEAD`];
}

/** Un record per commit: SHA, NUL, messaggio intero, separatore di record. */
export function parseRebaseCandidates(raw: string): RebaseCandidate[] {
	const candidates: RebaseCandidate[] = [];
	for (const chunk of raw.split("\x1e")) {
		const record = chunk.replace(/^\n+/, "");
		if (!record) continue;
		const nul = record.indexOf("\x00");
		if (nul === -1) continue;
		const sha = record.slice(0, nul).trim();
		if (!/^[0-9a-f]{40}$/.test(sha)) continue;
		const message = record.slice(nul + 1).replace(/\n+$/, "");
		candidates.push({ sha, message });
	}
	return candidates;
}

/** Prima riga del messaggio: l'oggetto mostrato nella lista. */
export function subjectOf(message: string): string {
	return message.split("\n")[0]?.trim() || "(senza messaggio)";
}
