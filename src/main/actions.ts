import {
	parseWorkflowRuns,
	workflowRunActionUrl,
	workflowRunsUrl,
	type WorkflowAction,
	type WorkflowRun,
} from "../core/actions.ts";
import {
	authHeaders,
	remoteIdentity,
	type Account,
} from "../core/providers.ts";
import { repoAccountChoice, tokenFor } from "./accounts.ts";
import { originRemote } from "./remote.ts";

/**
 * GitHub Actions: leggere le ultime esecuzioni e ri-eseguirle o annullarle.
 *
 * Non è una seconda implementazione di git: le esecuzioni vivono su GitHub, quindi si passa
 * dall'API con il token dell'account che possiede il repository. Le altre operazioni sui workflow
 * (modificarli, crearli) restano dove stanno: nei file del repository.
 */

interface ActionsContext {
	namespace: string;
	name: string;
	token: string;
	/** non nullo: `contextFor` si ferma prima se non c'è un account */
	account: Account;
}

async function contextFor(root: string): Promise<ActionsContext> {
	const remote = await originRemote(root);
	const identity = remote ? remoteIdentity(remote) : null;
	if (!identity)
		throw new Error(
			"Il remoto «origin» non è un repository su un servizio web: le Actions non ci sono."
		);
	const choice = await repoAccountChoice(root);
	const account = choice.account;
	if (!account)
		throw new Error(
			`Serve un account ${identity.host}: collegalo qui sopra e riprova.`
		);
	if (account.provider !== "github")
		throw new Error(
			"Le Actions sono una funzione di GitHub: questo repository sta su un altro servizio."
		);
	const token = await tokenFor(account);
	if (!token)
		throw new Error(
			`Token non disponibile per ${account.username}: reinseriscilo nell'account.`
		);
	return {
		namespace: identity.namespace,
		name: identity.name,
		token,
		account,
	};
}

export async function listWorkflowRuns(root: string): Promise<WorkflowRun[]> {
	const context = await contextFor(root);
	const account = context.account;
	let response: Response;
	try {
		response = await fetch(
			workflowRunsUrl(account, context.namespace, context.name),
			{
				headers: authHeaders(account, context.token),
				signal: AbortSignal.timeout(20_000),
			}
		);
	} catch (error) {
		throw new Error(
			`GitHub non raggiungibile: ${
				error instanceof Error ? error.message : String(error)
			}`
		);
	}
	if (response.status === 401 || response.status === 403)
		throw new Error("Token non valido o scaduto: aggiornalo nell'account.");
	if (!response.ok) {
		const detail = (await response.text().catch(() => "")).slice(0, 200);
		throw new Error(
			`GitHub: ${response.status} ${response.statusText}${
				detail ? ` — ${detail.replace(/\s+/g, " ").trim()}` : ""
			}`
		);
	}
	return parseWorkflowRuns(await response.json().catch(() => null));
}

/** `rerun` ripete tutti i job, `rerun-failed` solo quelli falliti, `cancel` ferma un'esecuzione. */
export async function runWorkflowAction(
	root: string,
	id: string,
	action: WorkflowAction
): Promise<void> {
	const context = await contextFor(root);
	const account = context.account;
	const response = await fetch(
		workflowRunActionUrl(
			account,
			context.namespace,
			context.name,
			id,
			action
		),
		{
			method: "POST",
			headers: authHeaders(account, context.token),
			signal: AbortSignal.timeout(20_000),
		}
	);
	if (response.status === 401 || response.status === 403)
		throw new Error("Token non valido o scaduto: aggiornalo nell'account.");
	if (!response.ok) {
		const detail = (await response.text().catch(() => "")).slice(0, 200);
		throw new Error(
			`GitHub: ${response.status} ${response.statusText}${
				detail ? ` — ${detail.replace(/\s+/g, " ").trim()}` : ""
			}`
		);
	}
}
