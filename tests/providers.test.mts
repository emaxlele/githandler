import assert from "node:assert/strict";
import { test } from "node:test";

import {
	accountId,
	ASKPASS_SCRIPT,
	askpassEnv,
	assertToken,
	cloneArgs,
	credentialInput,
	hostFromUrl,
	initArgs,
	normalizeAccount,
	parseAccounts,
	parseRemoteRepos,
	repoNameFromUrl,
	reposUrl,
	serializeAccounts,
	type Account,
} from "../src/core/providers.ts";

const github: Account = {
	id: "github:github.com:emaxlele",
	provider: "github",
	label: "",
	host: "github.com",
	apiBase: "https://api.github.com",
	username: "emaxlele",
	addedAt: 1,
};

test("normalizeAccount rifiuta provider, host e token impossibili", () => {
	const good = normalizeAccount({
		provider: "gitlab",
		host: "gitlab.example.org",
		apiBase: "https://gitlab.example.org/api/v4",
		username: "mario",
		label: "  lavoro  ",
		addedAt: 5,
	});
	assert.deepEqual(good, {
		id: "gitlab:gitlab.example.org:mario",
		provider: "gitlab",
		label: "lavoro",
		host: "gitlab.example.org",
		apiBase: "https://gitlab.example.org/api/v4",
		username: "mario",
		addedAt: 5,
	});

	for (const bad of [
		null,
		{ provider: "svn", host: "a.it", username: "u" },
		{ provider: "github", host: "a b", username: "u" },
		{ provider: "github", host: "github.com", username: "u v" },
		{ provider: "github", host: "github.com", username: "u", apiBase: "ftp://x" },
		{ provider: "github", host: "github.com", username: "" },
	]) {
		assert.equal(normalizeAccount(bad), null, JSON.stringify(bad));
	}
});

test("l'elenco salvato ignora voci rotte e doppioni", () => {
	const raw = JSON.stringify({
		accounts: [
			{ provider: "github", host: "github.com", username: "a" },
			{ provider: "github", host: "github.com", username: "a" },
			{ provider: "nope", host: "x.it", username: "b" },
		],
	});
	const accounts = parseAccounts(raw);
	assert.equal(accounts.length, 1);
	assert.equal(accounts[0]!.id, accountId("github", "github.com", "a"));

	// file corrotto o assente = nessun account, non un errore
	assert.deepEqual(parseAccounts("{"), []);
	assert.deepEqual(parseAccounts(""), []);
	assert.deepEqual(parseAccounts("[]"), []);
});

test("serialize/parse fanno il giro completo", () => {
	const text = serializeAccounts([github]);
	assert.deepEqual(parseAccounts(text), [github]);
});

test("URL dell'API e header per ogni provider", () => {
	assert.match(reposUrl(github), /^https:\/\/api\.github\.com\/user\/repos\?/);
	assert.match(
		reposUrl({ ...github, provider: "gitlab", apiBase: "https://gitlab.com/api/v4" }),
		/^https:\/\/gitlab\.com\/api\/v4\/projects\?membership=true/
	);
	assert.match(
		reposUrl({
			...github,
			provider: "gitea",
			host: "git.example.org",
			apiBase: "https://git.example.org/api/v1",
		}),
		/\/user\/repos\?limit=50/
	);
	assert.match(
		reposUrl({
			...github,
			provider: "bitbucket",
			username: "mario rossi",
			apiBase: "https://api.bitbucket.org/2.0",
		}),
		/repositories\/mario%20rossi\?role=member/
	);
});

test("il token resta fuori dall'URL e nei soli header", () => {
	const url = reposUrl(github);
	assert.equal(url.includes("token"), false);
	assert.deepEqual(askpassEnv("/tmp/askpass.sh", "emaxlele", "abc123"), {
		GIT_ASKPASS: "/tmp/askpass.sh",
		GIT_TERMINAL_PROMPT: "0",
		GITHANDLER_USER: "emaxlele",
		GITHANDLER_TOKEN: "abc123",
	});
	assert.match(ASKPASS_SCRIPT, /GITHANDLER_TOKEN/);
});

test("un a capo nelle credenziali sarebbe un'iniezione: si rifiuta", () => {
	for (const bad of ["", "due parole", "a\npassword=altro", "a\tb"]) {
		assert.throws(() => assertToken(bad), /Token non valido/, JSON.stringify(bad));
		assert.throws(
			() => credentialInput("github.com", "u", bad),
			/Token non valido/,
			JSON.stringify(bad)
		);
	}
	assert.throws(
		() => credentialInput("github.com", "u\npassword=x", "abc"),
		/Utente non valido/
	);
	assert.equal(
		credentialInput("github.com", "u", "abc"),
		"protocol=https\nhost=github.com\nusername=u\npassword=abc\n\n"
	);
});

test("parseRemoteRepos normalizza le quattro risposte", () => {
	const gh = parseRemoteRepos("github", [
		{
			full_name: "emaxlele/githandler",
			clone_url: "https://github.com/emaxlele/githandler.git",
			html_url: "https://github.com/emaxlele/githandler",
			private: true,
			updated_at: "2026-11-08T10:00:00Z",
		},
		{ full_name: "senza-clone" },
	]);
	assert.deepEqual(gh, [
		{
			fullName: "emaxlele/githandler",
			name: "githandler",
			cloneUrl: "https://github.com/emaxlele/githandler.git",
			webUrl: "https://github.com/emaxlele/githandler",
			private: true,
			updatedAt: "2026-11-08T10:00:00Z",
		},
	]);

	const gl = parseRemoteRepos("gitlab", [
		{
			path_with_namespace: "gruppo/progetto",
			http_url_to_repo: "https://gitlab.com/gruppo/progetto.git",
			web_url: "https://gitlab.com/gruppo/progetto",
			visibility: "private",
			last_activity_at: "2026-11-07T09:30:00Z",
		},
	]);
	assert.equal(gl[0]!.name, "progetto");
	assert.equal(gl[0]!.private, true);

	const bb = parseRemoteRepos("bitbucket", {
		values: [
			{
				full_name: "team/repo",
				links: {
					clone: [
						{ name: "ssh", href: "git@bitbucket.org:team/repo.git" },
						{ name: "https", href: "https://bitbucket.org/team/repo.git" },
					],
					html: { href: "https://bitbucket.org/team/repo" },
				},
				is_private: true,
				updated_on: "2026-11-06T08:00:00Z",
			},
		],
	});
	assert.equal(bb[0]!.cloneUrl, "https://bitbucket.org/team/repo.git");
	assert.equal(bb[0]!.private, true);

	// risposta inattesa: nessun crash, nessun repository
	assert.deepEqual(parseRemoteRepos("github", { message: "Bad credentials" }), []);
});

test("nome della cartella e host dagli URL git", () => {
	assert.equal(
		repoNameFromUrl("https://github.com/emaxlele/githandler.git"),
		"githandler"
	);
	assert.equal(repoNameFromUrl("git@github.com:emaxlele/githandler.git"), "githandler");
	assert.equal(repoNameFromUrl("ssh://git@host:2222/a/b.git/"), "b");
	assert.equal(repoNameFromUrl("https://host/gruppo/sotto/repo"), "repo");
	assert.equal(repoNameFromUrl("file:///tmp/repo-di-prova.git"), "repo-di-prova");
	assert.throws(() => repoNameFromUrl("https://github.com/"), /non si ricava un nome/);

	assert.equal(hostFromUrl("https://github.com/a/b.git"), "github.com");
	assert.equal(hostFromUrl("git@gitlab.com:gruppo/progetto.git"), "gitlab.com");
	assert.equal(hostFromUrl("ssh://git@server.example.org:2222/a/b.git"), "server.example.org:2222");
	assert.equal(hostFromUrl("file:///tmp/repo.git"), null);
	assert.equal(hostFromUrl("/tmp/repo.git"), null);
});

test("clone e init non trasformano l'URL o il path in opzioni", () => {
	assert.deepEqual(cloneArgs("https://host/a/b.git", "/tmp/b"), [
		"clone",
		"--",
		"https://host/a/b.git",
		"/tmp/b",
	]);
	assert.deepEqual(initArgs("/tmp/nuovo"), ["init", "/tmp/nuovo"]);
	assert.throws(() => cloneArgs("https://host/a/b.git", "relativo"), /non assoluta/);
	assert.throws(() => initArgs("--upload-pack=evil"), /non assoluta/);
	assert.throws(() => cloneArgs("", "/tmp/x"), /URL del repository mancante/);
});
