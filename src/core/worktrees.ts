/**
 * Worktree di un repository: `git worktree list --porcelain` ridotto a oggetti.
 *
 * Il formato è a blocchi separati da una riga vuota; la prima riga di ogni blocco è sempre
 * `worktree <percorso>`. Le altre sono coppie chiave/valore (`HEAD`, `branch`) oppure flag
 * (`bare`, `detached`, `locked`, `prunable`). Il parser è puro: i comandi restano nel main.
 */

export interface WorktreeInfo {
	path: string;
	head: string | null;
	/** nome breve del ramo, `null` su HEAD staccato o repository bare */
	branch: string | null;
	bare: boolean;
	detached: boolean;
	locked: boolean;
	/** la cartella non esiste più: `git worktree prune` può toglierla */
	prunable: boolean;
	/** il worktree principale, che non si rimuove */
	main: boolean;
}

export function parseWorktrees(porcelain: string): WorktreeInfo[] {
	const result: WorktreeInfo[] = [];
	for (const block of porcelain.split(/\n\s*\n/)) {
		const lines = block
			.split("\n")
			.map((line) => line.trimEnd())
			.filter(Boolean);
		if (lines.length === 0) continue;

		let path: string | null = null;
		let head: string | null = null;
		let branch: string | null = null;
		let bare = false;
		let detached = false;
		let locked = false;
		let prunable = false;

		for (const line of lines) {
			const space = line.indexOf(" ");
			const key = space === -1 ? line : line.slice(0, space);
			const value = space === -1 ? "" : line.slice(space + 1);
			if (key === "worktree") path = value;
			else if (key === "HEAD") head = value || null;
			else if (key === "branch")
				branch = value.replace(/^refs\/heads\//, "") || null;
			else if (key === "bare") bare = true;
			else if (key === "detached") detached = true;
			else if (key === "locked") locked = true;
			else if (key === "prunable") prunable = true;
		}

		if (!path) continue;
		result.push({
			path,
			head,
			branch,
			bare,
			detached,
			locked,
			prunable,
			main: result.length === 0,
		});
	}
	return result;
}
