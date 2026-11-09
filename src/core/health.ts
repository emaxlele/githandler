/**
 * Salute del repository: i segnali che si notano solo quando è troppo tardi.
 *
 * Il controllo è puro: riceve i ref, gli stash, i submodule e il momento attuale, e restituisce
 * elenchi di cose da guardare. Nessuna rete e nessun comando Git: le chiamate restano nel main,
 * così la regola si prova con oggetti qualsiasi.
 */
import type { RefInfo, StashEntry, SubmoduleInfo } from "./types.ts";

/** Oltre questo tempo uno stash è «dimenticato»: non è una regola di Git, è un promemoria. */
export const STALE_STASH_DAYS = 30;

/**
 * Dimensioni oltre le quali il repository ha superato quello che l'interfaccia ha misurato:
 * `docs/backend-performance.md` prova 50.000 commit e 100.000 file con il refresh sotto i 200 ms,
 * quindi oltre queste soglie la pagina di storia e l'elenco dei file diventano il costo dominante.
 * Sono numeri misurati, non un limite tecnico: servono a dirlo prima che l'utente se ne accorga.
 */
export const LARGE_HISTORY_COMMITS = 50_000;
export const LARGE_WORKTREE_FILES = 100_000;

/** Quanto è grande il repository: due conteggi che costano poco e dicono molto. */
export interface HealthScale {
	/** commit raggiungibili da HEAD */
	commits: number;
	/** file tracciati nell'indice */
	files: number;
}

export interface HealthInput {
	refs: RefInfo[];
	stashes: StashEntry[];
	submodules: SubmoduleInfo[];
	detached: boolean;
	/** millisecondi epoch: passato dall'esterno per rendere il controllo ripetibile nei test. */
	now: number;
	/** dimensioni del repository; assente quando non sono state misurate */
	scale?: HealthScale;
}

export interface HealthReport {
	/** rami locali con commit sia da inviare sia da ricevere: un merge è inevitabile. */
	diverged: Array<{ name: string; ahead: number; behind: number }>;
	/** rami locali senza upstream: non si sa se sono salvati da qualche parte. */
	orphanBranches: string[];
	/** stash più vecchi della soglia, dal più vecchio. */
	staleStashes: StashEntry[];
	/** submodule non puliti: modificati, non inizializzati o in conflitto. */
	dirtySubmodules: SubmoduleInfo[];
	/** HEAD staccato: i commit nuovi non appartengono a nessun ramo. */
	detached: boolean;
	/** dimensioni misurate, sempre presenti (zero quando non lette). */
	scale: HealthScale;
	/** true quando una delle due dimensioni supera le soglie misurate. */
	outgrown: boolean;
	/** true quando non c'è niente da segnalare. */
	clean: boolean;
}

export function assessHealth(input: HealthInput): HealthReport {
	const scale = input.scale ?? { commits: 0, files: 0 };
	const outgrown =
		scale.commits > LARGE_HISTORY_COMMITS ||
		scale.files > LARGE_WORKTREE_FILES;

	const diverged = input.refs
		.filter(
			(ref) => ref.kind === "local" && ref.ahead > 0 && ref.behind > 0
		)
		.map((ref) => ({
			name: ref.short,
			ahead: ref.ahead,
			behind: ref.behind,
		}))
		.sort((a, b) => a.name.localeCompare(b.name));

	const orphanBranches = input.refs
		.filter((ref) => ref.kind === "local" && !ref.upstream)
		.map((ref) => ref.short)
		.sort((a, b) => a.localeCompare(b));

	const cutoff = input.now - STALE_STASH_DAYS * 86_400_000;
	const staleStashes = input.stashes
		.filter((stash) => stash.timestamp * 1000 < cutoff)
		.sort((a, b) => a.timestamp - b.timestamp);

	const dirtySubmodules = input.submodules.filter(
		(module) => module.state !== "clean"
	);

	return {
		diverged,
		orphanBranches,
		staleStashes,
		dirtySubmodules,
		detached: input.detached,
		scale,
		outgrown,
		clean:
			diverged.length === 0 &&
			orphanBranches.length === 0 &&
			staleStashes.length === 0 &&
			dirtySubmodules.length === 0 &&
			!input.detached &&
			!outgrown,
	};
}
