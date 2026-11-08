import {
	assertClientId,
	deviceFlow,
	deviceRequestBody,
	deviceTokenBody,
	parseDeviceAuthorization,
	parseDeviceToken,
	parseUserLogin,
} from "../core/oauth.ts";
import {
	accountId,
	authHeaders,
	type Account,
} from "../core/providers.ts";
import type { AccountInput } from "../shared/api.ts";
import { saveAccount } from "./accounts.ts";

/**
 * Accesso dal browser (OAuth device flow).
 *
 * Il main chiede il codice, lo restituisce alla finestra perché lo mostri, e interroga il provider
 * finché l'utente non autorizza. **Il token non torna al renderer**: appena arriva, il main legge il
 * nome dell'utente e salva l'account, quindi la finestra riceve solo «fatto, questo account».
 * L'annullamento (chiusura del dialogo, nuovo tentativo) ferma il ciclo.
 */

export interface OAuthEvent {
	state: "ok" | "error";
	message?: string;
	accountId?: string;
}

export interface OAuthStart {
	/** codice da mostrare all'utente: si incolla nella pagina di verifica */
	userCode: string;
	verificationUri: string;
	expiresIn: number;
}

interface Session {
	cancelled: boolean;
}

let session: Session | null = null;

export function cancelOAuth(): void {
	if (session) session.cancelled = true;
	session = null;
}

function delay(ms: number): Promise<void> {
	return new Promise((resolve) => setTimeout(resolve, ms));
}

async function postForm(url: string, body: string): Promise<unknown> {
	let response: Response;
	try {
		response = await fetch(url, {
			method: "POST",
			headers: {
				"content-type": "application/x-www-form-urlencoded",
				accept: "application/json",
			},
			body,
			signal: AbortSignal.timeout(20_000),
		});
	} catch (error) {
		throw new Error(
			`Provider non raggiungibile: ${
				error instanceof Error ? error.message : String(error)
			}`
		);
	}
	const text = await response.text();
	try {
		return JSON.parse(text) as unknown;
	} catch {
		// alcuni endpoint rispondono `key=value&…` quando non gradiscono l'Accept
		const params = new URLSearchParams(text);
		if ([...params.keys()].length === 0)
			throw new Error(
				`${url}: risposta ${response.status} non leggibile.`
			);
		return Object.fromEntries(params.entries());
	}
}

/** Chi è l'utente che ha appena autorizzato: serve per il nome dell'account. */
async function fetchLogin(
	userUrl: string,
	input: AccountInput,
	token: string
): Promise<string> {
	const anonymous: Account = {
		id: "",
		provider: input.provider,
		label: "",
		host: input.host,
		apiBase: input.apiBase,
		username: input.username || "utente",
		addedAt: Date.now(),
		oauthClientId: input.oauthClientId ?? "",
	};
	const response = await fetch(userUrl, {
		headers: authHeaders(anonymous, token),
		signal: AbortSignal.timeout(20_000),
	});
	if (!response.ok)
		throw new Error(
			`L'accesso è riuscito ma il provider non dice chi sei (${response.status}).`
		);
	const payload = await response.json().catch(() => null);
	const login = parseUserLogin(input.provider, payload);
	if (!login)
		throw new Error(
			"L'accesso è riuscito ma il provider non ha restituito il nome utente."
		);
	return login;
}

async function poll(options: {
	mine: Session;
	input: AccountInput;
	clientId: string;
	tokenUrl: string;
	userUrl: string;
	deviceCode: string;
	expiresIn: number;
	interval: number;
	notify: (event: OAuthEvent) => void;
}): Promise<void> {
	const { mine, notify } = options;
	const deadline = Date.now() + options.expiresIn * 1000;
	let waitMs = Math.max(1, options.interval) * 1000;

	try {
		while (!mine.cancelled && Date.now() < deadline) {
			await delay(waitMs);
			if (mine.cancelled) return;

			const payload = await postForm(
				options.tokenUrl,
				deviceTokenBody(options.clientId, options.deviceCode)
			);
			const result = parseDeviceToken(payload);

			if (result.state === "token") {
				const login = await fetchLogin(
					options.userUrl,
					options.input,
					result.token
				);
				await saveAccount(
					{
						...options.input,
						username: login,
						oauthClientId: options.clientId,
					},
					result.token
				);
				notify({
					state: "ok",
					accountId: accountId(
						options.input.provider,
						options.input.host,
						login
					),
				});
				return;
			}
			if (result.state === "slow_down") {
				// il provider chiede di rallentare: si allunga l'attesa, mai si accorcia
				waitMs = Math.min(waitMs + 5000, 65_000);
				continue;
			}
			if (result.state === "error") {
				notify({ state: "error", message: result.message });
				return;
			}
			// pending: si riprova allo stesso intervallo
		}
		if (!mine.cancelled)
			notify({
				state: "error",
				message:
					"Il codice è scaduto: avvia di nuovo l'accesso dal browser.",
			});
	} catch (error) {
		if (!mine.cancelled)
			notify({
				state: "error",
				message: error instanceof Error ? error.message : String(error),
			});
	} finally {
		if (session === mine) session = null;
	}
}

/**
 * Avvia il flusso: restituisce il codice da mostrare e continua a interrogare il provider in
 * sottofondo. L'esito arriva su `notify` (che il main gira in broadcast alla finestra).
 */
export async function startOAuth(
	input: AccountInput,
	clientId: string,
	notify: (event: OAuthEvent) => void
): Promise<OAuthStart> {
	const flow = deviceFlow(input.provider, input.host, input.apiBase);
	if (!flow)
		throw new Error(
			"Questo provider non ha l'accesso dal browser: usa «Crea un token nel browser»."
		);
	assertClientId(clientId);

	cancelOAuth();
	const mine: Session = { cancelled: false };
	session = mine;

	let authorization: Awaited<ReturnType<typeof parseDeviceAuthorization>>;
	try {
		authorization = parseDeviceAuthorization(
			await postForm(
				flow.deviceUrl,
				deviceRequestBody(clientId, flow.scope)
			)
		);
	} catch (error) {
		session = null;
		throw error;
	}

	void poll({
		mine,
		input: { ...input, oauthClientId: clientId },
		clientId,
		tokenUrl: flow.tokenUrl,
		userUrl: flow.userUrl,
		deviceCode: authorization.deviceCode,
		expiresIn: authorization.expiresIn,
		interval: authorization.interval,
		notify,
	});

	return {
		userCode: authorization.userCode,
		verificationUri: authorization.verificationUri,
		expiresIn: authorization.expiresIn,
	};
}
