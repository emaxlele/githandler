import assert from "node:assert/strict";
import { test } from "node:test";

import {
	assertClientId,
	deviceFlow,
	deviceRequestBody,
	deviceTokenBody,
	parseDeviceAuthorization,
	parseDeviceToken,
	parseUserLogin,
	tokenPageUrl,
} from "../src/core/oauth.ts";

test("device flow: GitHub ufficiale e GitLab anche self-hosted", () => {
	const github = deviceFlow("github", "github.com", "https://api.github.com");
	assert.deepEqual(github, {
		deviceUrl: "https://github.com/login/device/code",
		tokenUrl: "https://github.com/login/oauth/access_token",
		userUrl: "https://api.github.com/user",
		scope: "repo read:org",
		clientPageUrl: "https://github.com/settings/applications/new",
	});

	const gitlab = deviceFlow(
		"gitlab",
		"gitlab.example.org",
		"https://gitlab.example.org/api/v4"
	);
	assert.equal(
		gitlab?.deviceUrl,
		"https://gitlab.example.org/oauth/authorize_device"
	);
	assert.equal(gitlab?.tokenUrl, "https://gitlab.example.org/oauth/token");
	assert.equal(gitlab?.userUrl, "https://gitlab.example.org/api/v4/user");
	assert.equal(gitlab?.scope, "read_api read_user");

	// Gitea e Bitbucket non hanno device flow
	assert.equal(deviceFlow("gitea", "git.example.org", "https://git.example.org/api/v1"), null);
	assert.equal(deviceFlow("bitbucket", "bitbucket.org", "https://api.bitbucket.org/2.0"), null);
});

test("pagine dei token per tutti i provider", () => {
	assert.match(tokenPageUrl("github", "github.com"), /settings\/tokens\/new\?scopes=repo,read:org/);
	assert.equal(
		tokenPageUrl("gitlab", "gitlab.example.org", "https://gitlab.example.org/api/v4"),
		"https://gitlab.example.org/-/user_settings/personal_access_tokens"
	);
	assert.equal(
		tokenPageUrl("gitea", "git.example.org", "https://git.example.org/api/v1"),
		"https://git.example.org/user/settings/applications"
	);
	assert.equal(
		tokenPageUrl("bitbucket", "bitbucket.org"),
		"https://bitbucket.org/account/settings/app-passwords/new"
	);
});

test("i corpi delle richieste sono form-urlencoded e senza a capo", () => {
	assert.equal(
		deviceRequestBody(" Iv1.abc ", "repo read:org"),
		"client_id=Iv1.abc&scope=repo+read%3Aorg"
	);
	assert.equal(
		deviceTokenBody("Iv1.abc", "dc-123"),
		"client_id=Iv1.abc&device_code=dc-123&grant_type=urn%3Aietf%3Aparams%3Aoauth%3Agrant-type%3Adevice_code"
	);
	for (const bad of ["", "  ", "due parole", "a\nb"]) {
		assert.throws(() => assertClientId(bad), /Client ID non valido/, JSON.stringify(bad));
		assert.throws(() => deviceRequestBody(bad, "repo"), /Client ID non valido/);
	}
	assert.throws(() => deviceTokenBody("Iv1.abc", "  "), /Codice del dispositivo mancante/);
});

test("la risposta del codice: valori sensati e errori leggibili", () => {
	assert.deepEqual(
		parseDeviceAuthorization({
			device_code: "dc-1",
			user_code: "ABCD-1234",
			verification_uri: "https://github.com/login/device",
			expires_in: 900,
			interval: 5,
		}),
		{
			deviceCode: "dc-1",
			userCode: "ABCD-1234",
			verificationUri: "https://github.com/login/device",
			expiresIn: 900,
			interval: 5,
		}
	);

	// intervallo assente o assurdo: valori di sicurezza, non zero (che sarebbe un ciclo stretto)
	const safe = parseDeviceAuthorization({
		device_code: "dc-2",
		user_code: "X",
		verification_url: "https://gitlab.com/device",
		expires_in: -3,
		interval: 0,
	});
	assert.equal(safe.verificationUri, "https://gitlab.com/device");
	assert.equal(safe.expiresIn, 900);
	assert.equal(safe.interval, 5);

	assert.throws(
		() => parseDeviceAuthorization({ error: "device_flow_disabled" }),
		/device flow|risponde/i
	);
	assert.throws(() => parseDeviceAuthorization({ device_code: "x" }), /codice/);
	assert.throws(() => parseDeviceAuthorization(null), /non leggibile/);
});

test("l'interrogazione del token distingue attesa, rallentamento, scadenza e rifiuto", () => {
	assert.deepEqual(parseDeviceToken({ access_token: "gho_x" }), {
		state: "token",
		token: "gho_x",
	});
	assert.deepEqual(parseDeviceToken({ error: "authorization_pending" }), {
		state: "pending",
	});
	assert.deepEqual(parseDeviceToken({ error: "slow_down" }), { state: "slow_down" });
	assert.match(
		(parseDeviceToken({ error: "expired_token" }) as { message: string }).message,
		/scaduto/
	);
	assert.match(
		(parseDeviceToken({ error: "access_denied" }) as { message: string }).message,
		/negato/
	);
	assert.match(
		(parseDeviceToken({ error: "invalid_client" }) as { message: string }).message,
		/Client ID errato/
	);
	assert.match(
		(parseDeviceToken({ error: "nuovo_caso", error_description: "dettaglio" }) as {
			message: string;
		}).message,
		/dettaglio/
	);
	assert.match(
		(parseDeviceToken("strano") as { message: string }).message,
		/non leggibile/
	);
});

test("il nome dell'utente cambia campo fra i provider", () => {
	assert.equal(parseUserLogin("github", { login: "emaxlele" }), "emaxlele");
	assert.equal(parseUserLogin("gitlab", { username: "mario" }), "mario");
	assert.equal(parseUserLogin("gitea", { login: "test" }), "test");
	assert.equal(parseUserLogin("github", { login: "a b" }), null);
	assert.equal(parseUserLogin("github", null), null);
});
