/**
 * Accesso dal browser: OAuth *device flow* e pagine dei token.
 *
 * Il device flow esiste per i programmi che non possono ricevere una callback HTTP: si chiede un
 * codice, si mostra all'utente, lui autorizza nel browser e il programma interroga il provider finché
 * non riceve il token. Serve un **Client ID** di un'applicazione registrata: è pubblico (viaggia
 * nell'URL), non è un segreto, e per questo può stare accanto all'account in `accounts.json`.
 *
 * Senza Client ID resta la strada che funziona sempre: aprire la pagina del provider dove il token si
 * crea a mano, con gli scope già indicati nell'URL dove il provider lo permette.
 */

import { assertApiBase, assertHost, type ProviderId } from "./providers.ts";

export interface DeviceFlow {
	/** endpoint che rilascia il codice da mostrare all'utente */
	deviceUrl: string;
	/** endpoint che scambia il codice con il token */
	tokenUrl: string;
	/** endpoint che dice chi è l'utente, per ricavare il nome dell'account */
	userUrl: string;
	/** scope richiesti: il minimo per elencare i repository e leggere l'utente */
	scope: string;
	/** dove si crea l'applicazione OAuth, per ottenere il Client ID */
	clientPageUrl: string;
}

/** Origine web del provider: per GitLab l'API sta sotto `/api/v4`, il browser no. */
function webOrigin(host: string, apiBase: string): string {
	try {
		const url = new URL(apiBase);
		if (url.host.toLowerCase() === host.toLowerCase()) return url.origin;
	} catch {
		// apiBase non valido: si ricade sull'host
	}
	return `https://${host}`;
}

/**
 * GitHub e GitLab hanno il device flow; Gitea e Bitbucket no (Bitbucket usa le *app password*, che
 * sono comunque un utente + segreto e quindi entrano nello stesso campo token).
 */
export function deviceFlow(
	provider: ProviderId,
	host: string,
	apiBase: string
): DeviceFlow | null {
	assertHost(host);
	assertApiBase(apiBase);
	const base = apiBase.replace(/\/+$/, "");
	switch (provider) {
		case "github":
			return {
				deviceUrl: "https://github.com/login/device/code",
				tokenUrl: "https://github.com/login/oauth/access_token",
				userUrl: `${base}/user`,
				scope: "repo read:org",
				clientPageUrl: "https://github.com/settings/applications/new",
			};
		case "gitlab": {
			const origin = webOrigin(host, base);
			return {
				deviceUrl: `${origin}/oauth/authorize_device`,
				tokenUrl: `${origin}/oauth/token`,
				userUrl: `${base}/user`,
				scope: "read_api read_user",
				clientPageUrl: `${origin}/-/user_settings/applications`,
			};
		}
		case "gitea":
		case "bitbucket":
			// il device flow non esiste in questi provider: resta la pagina dei token
			return null;
	}
}

/**
 * Pagina dove si crea un token a mano, con gli scope quando il provider li accetta nell'URL.
 * Apre il browser: nessuna credenziale passa da qui.
 */
export function tokenPageUrl(
	provider: ProviderId,
	host: string,
	apiBase = ""
): string {
	assertHost(host);
	const origin = webOrigin(host, apiBase || `https://${host}`);
	switch (provider) {
		case "github":
			return "https://github.com/settings/tokens/new?scopes=repo,read:org&description=GitHandler";
		case "gitlab":
			return `${origin}/-/user_settings/personal_access_tokens`;
		case "gitea":
			return `${origin}/user/settings/applications`;
		case "bitbucket":
			return `${origin}/account/settings/app-passwords/new`;
	}
}

/** Corpo `application/x-www-form-urlencoded` per la richiesta del codice. */
export function deviceRequestBody(clientId: string, scope: string): string {
	const id = clientId.trim();
	assertClientId(id);
	const body = new URLSearchParams({ client_id: id });
	if (scope.trim()) body.set("scope", scope.trim());
	return body.toString();
}

/** Corpo per lo scambio del codice, secondo la RFC 8628. */
export function deviceTokenBody(clientId: string, deviceCode: string): string {
	assertClientId(clientId);
	if (!deviceCode.trim()) throw new Error("Codice del dispositivo mancante.");
	return new URLSearchParams({
		client_id: clientId,
		device_code: deviceCode.trim(),
		grant_type: "urn:ietf:params:oauth:grant-type:device_code",
	}).toString();
}

const TOKEN_SAFE = /^[\x21-\x7e]+$/;

/** Il Client ID è pubblico ma finisce in un corpo HTTP: una sola riga stampabile. */
export function assertClientId(clientId: string): void {
	if (!clientId.trim() || !TOKEN_SAFE.test(clientId.trim()))
		throw new Error(
			"Client ID non valido: incolla quello dell'applicazione OAuth del provider."
		);
}

export interface DeviceAuthorization {
	deviceCode: string;
	userCode: string;
	verificationUri: string;
	/** secondi di validità del codice */
	expiresIn: number;
	/** secondi minimi fra due interrogazioni */
	interval: number;
}

function asRecord(value: unknown): Record<string, unknown> | null {
	return typeof value === "object" && value !== null
		? (value as Record<string, unknown>)
		: null;
}

function text(value: unknown): string {
	return typeof value === "string" ? value : "";
}

function positive(value: unknown, fallback: number): number {
	return typeof value === "number" && Number.isFinite(value) && value > 0
		? value
		: fallback;
}

const DEVICE_ERRORS: Record<string, string> = {
	access_denied:
		"Accesso negato: l'autorizzazione è stata rifiutata nel browser.",
	expired_token: "Il codice è scaduto: avvia di nuovo l'accesso dal browser.",
	unsupported_grant_type: "Il provider non accetta questo tipo di accesso.",
	incorrect_client_credentials:
		"Client ID errato o applicazione senza device flow.",
	invalid_client: "Client ID errato o applicazione senza device flow.",
	invalid_request:
		"Richiesta rifiutata dal provider: controlla il Client ID.",
};

/** Risposta della richiesta del codice: `error` dichiarato vale come errore, non come successo vuoto. */
export function parseDeviceAuthorization(
	payload: unknown
): DeviceAuthorization {
	const record = asRecord(payload);
	if (!record) throw new Error("Risposta del provider non leggibile.");
	const error = text(record.error).trim();
	if (error) {
		const detail = text(record.error_description).trim();
		throw new Error(
			DEVICE_ERRORS[error] ?? `Il provider risponde: ${detail || error}`
		);
	}
	const deviceCode = text(record.device_code);
	const userCode = text(record.user_code);
	const verificationUri =
		text(record.verification_uri) || text(record.verification_url);
	if (!deviceCode || !userCode || !verificationUri)
		throw new Error("Il provider non ha restituito il codice da mostrare.");
	return {
		deviceCode,
		userCode,
		verificationUri,
		expiresIn: positive(record.expires_in, 900),
		interval: positive(record.interval, 5),
	};
}

export type DevicePoll =
	| { state: "token"; token: string }
	| { state: "pending" }
	| { state: "slow_down" }
	| { state: "error"; message: string };

/** Esito di una singola interrogazione del token endpoint. */
export function parseDeviceToken(payload: unknown): DevicePoll {
	const record = asRecord(payload);
	if (!record)
		return {
			state: "error",
			message: "Risposta del provider non leggibile.",
		};
	const token = text(record.access_token);
	if (token) return { state: "token", token };
	const error = text(record.error).trim();
	switch (error) {
		case "authorization_pending":
			return { state: "pending" };
		case "slow_down":
			return { state: "slow_down" };
		case "expired_token":
			return {
				state: "error",
				message:
					"Il codice è scaduto: avvia di nuovo l'accesso dal browser.",
			};
		case "access_denied":
			return {
				state: "error",
				message:
					"Accesso negato: l'autorizzazione è stata rifiutata nel browser.",
			};
	}
	return {
		state: "error",
		message:
			DEVICE_ERRORS[error] ??
			`Il provider risponde: ${
				text(record.error_description) || error || "esito sconosciuto"
			}`,
	};
}

/** Nome dell'utente dal payload di `GET /user`, che cambia campo da provider a provider. */
export function parseUserLogin(
	provider: ProviderId,
	payload: unknown
): string | null {
	const record = asRecord(payload);
	if (!record) return null;
	const candidate =
		provider === "gitlab"
			? text(record.username)
			: text(record.login) || text(record.username);
	const login = candidate.trim();
	return login && TOKEN_SAFE.test(login) ? login : null;
}
