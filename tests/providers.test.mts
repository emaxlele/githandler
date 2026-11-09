import assert from "node:assert/strict";
import { test } from "node:test";

import {
	accountId,
	ASKPASS_SCRIPT,
	askpassEnv,
	assertToken,
	cloneArgs,
	commitWebUrl,
	credentialInput,
	fileWebUrl,
	hostFromUrl,
	initArgs,
	normalizeAccount,
	parseAccounts,
	chooseRepoAccount,
	parseCredentialOutput,
	parseRemoteRepos,
	remoteIdentity,
	remoteWeb,
	reposPageSize,
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
	oauthClientId: "",
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
		oauthClientId: "",
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

	// il Client ID è pubblico e facoltativo: una riga sola, altrimenti si scarta
	assert.equal(
		normalizeAccount({
			provider: "github",
			host: "github.com",
			username: "u",
			oauthClientId: " Iv1.abc123 ",
		})?.oauthClientId,
		"Iv1.abc123"
	);
	assert.equal(
		normalizeAccount({
			provider: "github",
			host: "github.com",
			username: "u",
			oauthClientId: "a\nb",
		})?.oauthClientId,
		""
	);

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

test("dal remoto all'indirizzo web, per ogni servizio", () => {
	assert.deepEqual(remoteWeb("https://github.com/emaxlele/githandler.git"), {
		host: "github.com",
		base: "https://github.com/emaxlele/githandler",
		kind: "github",
	});
	assert.equal(
		remoteWeb("git@github.com:emaxlele/githandler.git")?.base,
		"https://github.com/emaxlele/githandler"
	);
	assert.equal(
		remoteWeb("ssh://git@gitlab.example.org:2222/gruppo/sotto/progetto.git")?.base,
		"https://gitlab.example.org:2222/gruppo/sotto/progetto"
	);
	assert.equal(
		remoteWeb("https://host/gruppo/repo/")?.base,
		"https://host/gruppo/repo"
	);
	// niente sito da aprire
	assert.equal(remoteWeb("/tmp/repo.git"), null);
	assert.equal(remoteWeb("file:///tmp/repo.git"), null);
	assert.equal(remoteWeb("https://github.com/solo"), null);
	assert.equal(remoteWeb(""), null);

	assert.equal(
		commitWebUrl("git@github.com:emaxlele/githandler.git", "ed010999af"),
		"https://github.com/emaxlele/githandler/commit/ed010999af"
	);
	assert.equal(
		commitWebUrl("https://gitlab.com/gruppo/progetto.git", "ed010999af"),
		"https://gitlab.com/gruppo/progetto/-/commit/ed010999af"
	);
	assert.equal(
		commitWebUrl("https://bitbucket.org/team/repo.git", "ed010999af"),
		"https://bitbucket.org/team/repo/commits/ed010999af"
	);
	assert.equal(
		commitWebUrl("git@github.com:emaxlele/githandler.git", "non-uno-sha"),
		null
	);
	assert.equal(commitWebUrl("/tmp/repo.git", "ed010999af"), null);

	assert.equal(
		fileWebUrl("https://github.com/o/r.git", "feature/x", "src/app main.ts"),
		"https://github.com/o/r/blob/feature/x/src/app%20main.ts"
	);
	assert.equal(
		fileWebUrl("https://gitlab.com/o/r.git", "main", "a/b.txt"),
		"https://gitlab.com/o/r/-/blob/main/a/b.txt"
	);
	assert.equal(
		fileWebUrl("https://bitbucket.org/o/r.git", "main", "a/b.txt"),
		"https://bitbucket.org/o/r/src/main/a/b.txt"
	);
	// Gitea/Forgejo non si riconosce dall'host: lo dice il provider dell'account
	assert.equal(
		fileWebUrl("https://git.example.org/o/r.git", "main", "a.txt", "gitea"),
		"https://git.example.org/o/r/src/branch/main/a.txt"
	);
	assert.equal(
		fileWebUrl("https://git.example.org/o/r.git", "main", "a.txt"),
		null
	);
	// il provider vince anche quando l'host sembra un altro servizio
	assert.equal(
		fileWebUrl("https://github.com/o/r.git", "dev", "a/b.txt", "gitea"),
		"https://github.com/o/r/src/branch/dev/a/b.txt"
	);
	assert.equal(fileWebUrl("https://github.com/o/r.git", "", "a.txt"), null);
});

test("identità del remoto: host, namespace, proprietario e nome", () => {
	assert.deepEqual(remoteIdentity("git@github.com:emaxlele/githandler.git"), {
		host: "github.com",
		namespace: "emaxlele",
		owner: "emaxlele",
		name: "githandler",
		base: "https://github.com/emaxlele/githandler",
		kind: "github",
	});
	// GitLab: il namespace può essere un gruppo con sottogruppi, il proprietario è il primo
	assert.deepEqual(
		remoteIdentity("https://gitlab.com/gruppo/sotto/progetto.git"),
		{
			host: "gitlab.com",
			namespace: "gruppo/sotto",
			owner: "gruppo",
			name: "progetto",
			base: "https://gitlab.com/gruppo/sotto/progetto",
			kind: "gitlab",
		}
	);
	assert.equal(remoteIdentity("/tmp/repo.git"), null);
	assert.equal(remoteIdentity("https://github.com/solo"), null);
});

test("quale account per un repository: scelta salvata, proprietario, unico, primo", () => {
	const base: Account = {
		id: "github:github.com:emaxlele",
		provider: "github",
		label: "",
		host: "github.com",
		apiBase: "https://api.github.com",
		username: "emaxlele",
		addedAt: 1,
		oauthClientId: "",
	};
	const other: Account = {
		...base,
		id: "github:github.com:lavoro",
		username: "lavoro",
		addedAt: 2,
	};
	const gitlab: Account = {
		...base,
		id: "gitlab:gitlab.com:emaxlele",
		provider: "gitlab",
		host: "gitlab.com",
		apiBase: "https://gitlab.com/api/v4",
	};
	const remote = "git@github.com:emaxlele/githandler.git";

	// 1. la scelta dell'utente vince su tutto
	assert.deepEqual(
		(() => {
			const choice = chooseRepoAccount([base, other], other.id, remote);
			return [choice.account?.id, choice.reason];
		})(),
		[other.id, "saved"]
	);

	// 2. altrimenti l'utente che corrisponde al proprietario del remoto
	assert.deepEqual(
		(() => {
			const choice = chooseRepoAccount([other, base], null, remote);
			return [choice.account?.id, choice.reason];
		})(),
		[base.id, "owner"]
	);
	// il confronto è esatto: `emax` non è `emaxlele`
	assert.equal(
		chooseRepoAccount(
			[{ ...base, id: "github:github.com:emax", username: "emax" }],
			null,
			remote
		).reason,
		"single"
	);

	// 3. unico account dell'host
	assert.equal(
		chooseRepoAccount([gitlab, base], null, "https://github.com/x/y.git").reason,
		"single"
	);
	assert.equal(
		chooseRepoAccount([gitlab], null, "https://github.com/x/y.git").account,
		null
	);

	// 4. più account dello stesso host, nessuna corrispondenza: il primo, dichiarato
	const choice = chooseRepoAccount([other, base], null, "https://github.com/terzi/x.git");
	assert.equal(choice.reason, "first");
	assert.equal(choice.account?.id, other.id);
	assert.deepEqual(choice.candidates.map((a) => a.id), [other.id, base.id]);

	// la scelta salvata di un altro host non vale qui
	assert.equal(
		chooseRepoAccount([base, gitlab], gitlab.id, remote).account?.id,
		base.id
	);
	// repository senza remoto: nessun host, nessun candidato
	assert.deepEqual(chooseRepoAccount([base], base.id, null), {
		account: null,
		reason: "none",
		candidates: [],
		host: null,
	});
});

test("l'output di `git credential fill` si legge in modo stretto", () => {
	assert.deepEqual(parseCredentialOutput("username=emaxlele\npassword=gho_x\n"), {
		username: "emaxlele",
		password: "gho_x",
	});
	// senza utente è comunque un segreto usabile (alcuni helper lo omettono)
	assert.deepEqual(parseCredentialOutput("password=abc\n"), {
		username: "",
		password: "abc",
	});
	assert.equal(parseCredentialOutput("username=x\n"), null);
	assert.equal(parseCredentialOutput(""), null);
	// a capo nei valori: sarebbero campi diversi
	assert.equal(parseCredentialOutput("username=a\nb\npassword=x"), null);
});

test("le pagine dell'elenco repository hanno la taglia del provider", () => {
	assert.equal(reposPageSize("github"), 100);
	assert.equal(reposPageSize("gitlab"), 100);
	assert.equal(reposPageSize("gitea"), 50);
	assert.equal(reposPageSize("bitbucket"), 100);
});

test("clone e init non trasformano l'URL o il path in opzioni", () => {
	assert.deepEqual(cloneArgs("https://host/a/b.git", "/tmp/b"), [
		"clone",
		"--progress",
		"--",
		"https://host/a/b.git",
		"/tmp/b",
	]);
	assert.deepEqual(initArgs("/tmp/nuovo"), ["init", "/tmp/nuovo"]);
	assert.throws(() => cloneArgs("https://host/a/b.git", "relativo"), /non assoluta/);
	assert.throws(() => initArgs("--upload-pack=evil"), /non assoluta/);
	assert.throws(() => cloneArgs("", "/tmp/x"), /URL del repository mancante/);
});
