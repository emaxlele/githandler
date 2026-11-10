import assert from "node:assert/strict";
import { test } from "node:test";

import {
	checkRemoteUrl,
	describeUpstream,
	parseForkParent,
	parseRemoteBranches,
	parseRemotes,
	remoteUrlKey,
	repoApiUrl,
	type ForkParent,
} from "../src/core/fork.ts";
import type { Account } from "../src/core/providers.ts";

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

const gitlab: Account = {
	...github,
	id: "gitlab:gitlab.com:emaxlele",
	provider: "gitlab",
	host: "gitlab.com",
	apiBase: "https://gitlab.com/api/v4",
};

const bitbucket: Account = {
	...github,
	id: "bitbucket:bitbucket.org:emaxlele",
	provider: "bitbucket",
	host: "bitbucket.org",
	apiBase: "https://api.bitbucket.org/2.0",
};

test("l'indirizzo del repository cambia forma fra i provider", () => {
	assert.equal(
		repoApiUrl(github, "emaxlele", "githandler"),
		"https://api.github.com/repos/emaxlele/githandler"
	);
	// GitLab vuole il namespace codificato: un gruppo con `/` sarebbe un altro percorso
	assert.equal(
		repoApiUrl(gitlab, "gruppo/sotto", "progetto"),
		"https://gitlab.com/api/v4/projects/gruppo%2Fsotto%2Fprogetto"
	);
	assert.equal(
		repoApiUrl(bitbucket, "team", "repo"),
		"https://api.bitbucket.org/2.0/repositories/team/repo"
	);
});

test("il parent di un fork: GitHub, GitLab, Gitea e Bitbucket", () => {
	assert.deepEqual(
		parseForkParent("github", {
			fork: true,
			parent: {
				full_name: "upstream/progetto",
				clone_url: "https://github.com/upstream/progetto.git",
				html_url: "https://github.com/upstream/progetto",
				default_branch: "trunk",
			},
		}),
		{
			fullName: "upstream/progetto",
			cloneUrl: "https://github.com/upstream/progetto.git",
			webUrl: "https://github.com/upstream/progetto",
			defaultBranch: "trunk",
		}
	);

	assert.deepEqual(
		parseForkParent("gitlab", {
			forked_from_project: {
				path_with_namespace: "gruppo/originale",
				http_url_to_repo: "https://gitlab.com/gruppo/originale.git",
				web_url: "https://gitlab.com/gruppo/originale",
				default_branch: "main",
			},
		}),
		{
			fullName: "gruppo/originale",
			cloneUrl: "https://gitlab.com/gruppo/originale.git",
			webUrl: "https://gitlab.com/gruppo/originale",
			defaultBranch: "main",
		}
	);

	assert.deepEqual(
		parseForkParent("gitea", {
			parent: {
				full_name: "upstream/progetto",
				clone_url: "https://git.example.org/upstream/progetto.git",
				html_url: "https://git.example.org/upstream/progetto",
				default_branch: "dev",
			},
		})?.defaultBranch,
		"dev"
	);

	assert.deepEqual(
		parseForkParent("bitbucket", {
			parent: {
				full_name: "upstream/progetto",
				mainbranch: { name: "main" },
				links: {
					html: { href: "https://bitbucket.org/upstream/progetto" },
					clone: [
						{ name: "https", href: "https://bitbucket.org/upstream/progetto.git" },
						{ name: "ssh", href: "git@bitbucket.org:upstream/progetto.git" },
					],
				},
			},
		}),
		{
			fullName: "upstream/progetto",
			cloneUrl: "https://bitbucket.org/upstream/progetto.git",
			webUrl: "https://bitbucket.org/upstream/progetto",
			defaultBranch: "main",
		}
	);
});

test("un repository che non è un fork non ha parent", () => {
	assert.equal(parseForkParent("github", { fork: false }), null);
	assert.equal(parseForkParent("github", { parent: null }), null);
	assert.equal(parseForkParent("gitlab", { forked_from_project: null }), null);
	assert.equal(parseForkParent("github", null), null);
	// un parent senza URL non è sincronizzabile: meglio nessun parent che un remoto vuoto
	assert.equal(
		parseForkParent("github", {
			parent: { full_name: "upstream/x", default_branch: "main" },
		}),
		null
	);
	// e un payload che non è un oggetto non deve esplodere
	assert.equal(parseForkParent("bitbucket", "strano"), null);
});

test("i rami dell'originale si leggono da ls-remote, senza duplicati", () => {
	const output = [
		"a\trefs/heads/main",
		"b\trefs/heads/dev",
		"c\trefs/heads/main",
		"d\trefs/tags/v1.0",
		"riga senza tab",
		"e\trefs/heads/feature/x",
	].join("\n");
	assert.deepEqual(parseRemoteBranches(output), [
		"dev",
		"feature/x",
		"main",
	]);
	assert.deepEqual(parseRemoteBranches(""), []);
});

const original: ForkParent = {
	fullName: "upstream/progetto",
	cloneUrl: "https://github.com/upstream/progetto.git",
	webUrl: "https://github.com/upstream/progetto",
	defaultBranch: "main",
};

test("i remoti si leggono da git remote -v, solo il lato fetch", () => {
	const output = [
		"origin\thttps://github.com/me/fork.git (fetch)",
		"origin\thttps://github.com/me/fork.git (push)",
		"upstream\tgit@github.com:upstream/progetto.git (fetch)",
		"upstream\tgit@github.com:upstream/progetto.git (push)",
		"locale\t/tmp/cartella con spazi/repo.git (fetch)",
		"riga senza tab",
	].join("\n");
	assert.deepEqual(parseRemotes(output), [
		{ name: "origin", url: "https://github.com/me/fork.git" },
		{ name: "upstream", url: "git@github.com:upstream/progetto.git" },
		{ name: "locale", url: "/tmp/cartella con spazi/repo.git" },
	]);
	assert.deepEqual(parseRemotes(""), []);
});

test("l'indirizzo del remoto si accetta solo se può stare in un argomento", () => {
	assert.equal(
		checkRemoteUrl("  https://github.com/upstream/progetto.git  "),
		"https://github.com/upstream/progetto.git"
	);
	assert.equal(
		checkRemoteUrl("git@github.com:upstream/progetto.git"),
		"git@github.com:upstream/progetto.git"
	);
	// un percorso locale può contenere spazi: è un argomento solo, non una riga di comando
	assert.equal(
		checkRemoteUrl("/tmp/cartella con spazi/repo.git"),
		"/tmp/cartella con spazi/repo.git"
	);
	assert.throws(() => checkRemoteUrl("   "), /Scrivi l'indirizzo/);
	assert.throws(() => checkRemoteUrl("--upload-pack=evil"), /cominciare con «-»/);
	assert.throws(() => checkRemoteUrl("https://x/y\nrm -rf /"), /caratteri di controllo/);
	assert.throws(
		() => checkRemoteUrl("https://github.com/upstream/pro getto.git"),
		/contiene spazi/
	);
});

test("due forme dello stesso indirizzo si riconoscono", () => {
	const key = "github.com/upstream/progetto";
	assert.equal(remoteUrlKey("https://github.com/upstream/progetto.git"), key);
	assert.equal(remoteUrlKey("https://github.com/upstream/progetto/"), key);
	assert.equal(remoteUrlKey("https://www.github.com/upstream/progetto"), key);
	assert.equal(remoteUrlKey("git@github.com:upstream/progetto.git"), key);
	assert.equal(remoteUrlKey("ssh://git@github.com/upstream/progetto.git"), key);
	assert.notEqual(
		remoteUrlKey("https://github.com/io/progetto.git"),
		key
	);
});

test("lo stato del remoto dice se manca, combacia o punta altrove", () => {
	const remotes = [
		{ name: "origin", url: "https://github.com/io/progetto.git" },
	];

	// niente remoto, e senza API non si sa nemmeno qual è l'originale
	assert.deepEqual(describeUpstream({ url: null, remotes: [] }, null), {
		url: null,
		parent: null,
		parentError: null,
		state: "missing",
		sameAsOther: null,
		suggestion: null,
	});

	// niente remoto, ma l'originale si conosce: si può consigliare l'indirizzo
	const missing = describeUpstream({ url: null, remotes }, original);
	assert.equal(missing.state, "missing");
	assert.equal(missing.suggestion, original.cloneUrl);
	assert.equal(missing.sameAsOther, null);

	// `origin` è già l'originale: non serve un secondo remoto
	const same = describeUpstream(
		{ url: null, remotes: [{ name: "origin", url: original.cloneUrl }] },
		original
	);
	assert.equal(same.sameAsOther, "origin");

	// stessa forma scritta in modo diverso: allineato
	assert.equal(
		describeUpstream(
			{ url: "git@github.com:upstream/progetto.git", remotes },
			original
		).state,
		"aligned"
	);

	// indirizzo diverso: non è un errore, è un fatto da mostrare
	assert.equal(
		describeUpstream(
			{ url: "https://github.com/altro/progetto.git", remotes },
			original
		).state,
		"different"
	);

	// senza originale la configurazione resta valida, solo non verificabile
	const configured = describeUpstream(
		{ url: original.cloneUrl, remotes },
		null,
		"GitHub non raggiungibile"
	);
	assert.equal(configured.state, "configured");
	assert.equal(configured.parentError, "GitHub non raggiungibile");
});
