/**
 * Modello del messaggio di commit (`commit.template`).
 *
 * Git lo usa quando apre un editor; l'app scrive il messaggio su stdin (`commit -F -`), quindi deve
 * leggere il file da sola. Il percorso arriva dalla configurazione dell'utente e Git lo interpreta
 * rispetto alla radice del repository, con `~` per la home. Non c'è filesystem qui: solo la regola.
 */
import { isAbsolutePath } from "./paths.ts";
import type { CommitTemplate } from "./types.ts";

export const COMMIT_TEMPLATE_LIMIT = 64 * 1024;

/** Unisce senza usare `node:path`: il core resta puro e il separatore è quello di Git. */
function joinPath(base: string, relative: string): string {
	const left = base.replace(/\/+$/, "");
	const right = relative.replace(/^\.\/+/, "");
	return `${left}/${right}`;
}

/**
 * Percorso del modello a partire dal valore di `commit.template` e dalla home dell'utente.
 * `null` quando la configurazione è vuota; `~altro` non viene indovinato.
 */
export function resolveCommitTemplatePath(
	root: string,
	configured: string,
	home: string
): string | null {
	const value = configured.trim();
	if (!value) return null;
	if (value.includes("\u0000"))
		throw new Error("Il percorso del modello di commit contiene NUL.");
	if (value === "~") return home;
	if (value.startsWith("~/")) return joinPath(home, value.slice(2));
	if (/^~[^/]/.test(value))
		throw new Error(
			"Il modello di commit usa la home di un altro utente: percorso non supportato."
		);
	if (isAbsolutePath(value)) return value;
	return joinPath(root, value);
}

/** Taglia un modello enorme: il campo del messaggio non deve ricevere un file intero. */
export function limitCommitTemplate(text: string): CommitTemplate {
	const clean = text.replace(/\r\n/g, "\n");
	if (clean.length <= COMMIT_TEMPLATE_LIMIT)
		return { text: clean, truncated: false };
	return {
		text: clean.slice(0, COMMIT_TEMPLATE_LIMIT),
		truncated: true,
	};
}

/**
 * Argomenti di `git commit`: il messaggio arriva da stdin. `-a` include le modifiche tracciate,
 * `-S` firma con la chiave già configurata in Git (GPG o SSH): l'app non gestisce chiavi.
 */
export function commitArgs(all: boolean, sign: boolean): string[] {
	const args = ["commit"];
	if (all) args.push("-a");
	if (sign) args.push("-S");
	args.push("-F", "-");
	return args;
}
