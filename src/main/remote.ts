import { runGit } from "./git.ts";

/**
 * I remoto di un repository, letti al momento: niente cache, perché l'utente può cambiarli da
 * terminale mentre l'app è aperta.
 */

/** URL di un remoto; `null` se non esiste o è vuoto. */
export async function remoteUrl(
	root: string,
	name: string
): Promise<string | null> {
	const result = await runGit(root, ["remote", "get-url", name], {
		allowFailure: true,
	});
	if (result.code !== 0) return null;
	return result.stdout.trim() || null;
}

/** URL del remoto `origin`: serve ai link nel browser e alla scelta dell'account. */
export async function originRemote(root: string): Promise<string | null> {
	return remoteUrl(root, "origin");
}
