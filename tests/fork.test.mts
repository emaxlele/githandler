import assert from "node:assert/strict";
import { test } from "node:test";

import { parseForkParent, repoApiUrl } from "../src/core/fork.ts";
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
