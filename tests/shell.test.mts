import assert from "node:assert/strict";
import { test } from "node:test";

import {
	bashCandidates,
	gitInstallationRoot,
	POSIX_BASH,
	shellPlatform,
} from "../src/core/shell.ts";

test("shellPlatform: solo win32 è Windows", () => {
	assert.equal(shellPlatform("win32"), "windows");
	assert.equal(shellPlatform("linux"), "posix");
	assert.equal(shellPlatform("darwin"), "posix");
});

test("bashCandidates: su Linux e macOS basta il PATH", () => {
	assert.deepEqual(bashCandidates("linux", null, {}), [POSIX_BASH]);
	assert.deepEqual(bashCandidates("darwin", null, {}), [POSIX_BASH]);
});

test("bashCandidates: GITHANDLER_BASH vince su tutto", () => {
	assert.deepEqual(bashCandidates("linux", null, { GITHANDLER_BASH: "/opt/bash" }), [
		"/opt/bash",
	]);
	assert.deepEqual(
		bashCandidates("win32", null, { GITHANDLER_BASH: "D:\\msys64\\usr\\bin\\bash.exe" }),
		["D:\\msys64\\usr\\bin\\bash.exe"]
	);
});

test("bashCandidates: su Windows bash sta accanto a git", () => {
	const candidates = bashCandidates(
		"win32",
		"C:\\Program Files\\Git\\mingw64\\libexec\\git-core",
		{}
	);
	assert.deepEqual(candidates, [
		"C:\\Program Files\\Git\\bin\\bash.exe",
		"C:\\Program Files\\Git\\usr\\bin\\bash.exe",
	]);
});

test("bashCandidates: senza exec-path restano le cartelle standard di Windows", () => {
	const candidates = bashCandidates("win32", null, {
		ProgramFiles: "C:\\Program Files",
		LOCALAPPDATA: "C:\\Users\\utente\\AppData\\Local",
	});
	assert.deepEqual(candidates, [
		"C:\\Program Files\\Git\\bin\\bash.exe",
		"C:\\Program Files\\Git\\usr\\bin\\bash.exe",
		"C:\\Users\\utente\\AppData\\Local\\Programs\\Git\\bin\\bash.exe",
		"C:\\Users\\utente\\AppData\\Local\\Programs\\Git\\usr\\bin\\bash.exe",
	]);
});

test("bashCandidates: una radice non viene ripetuta", () => {
	const candidates = bashCandidates(
		"win32",
		"C:\\Program Files\\Git\\mingw64\\libexec\\git-core",
		{ ProgramFiles: "C:\\Program Files" }
	);
	assert.equal(candidates.length, 2);
});

test("gitInstallationRoot: ricava la radice e scarta quello che non lo è", () => {
	assert.equal(
		gitInstallationRoot("C:\\Program Files\\Git\\mingw64\\libexec\\git-core"),
		"C:\\Program Files\\Git"
	);
	assert.equal(
		gitInstallationRoot("C:/Program Files/Git/mingw64/libexec/git-core"),
		"C:\\Program Files\\Git"
	);
	assert.equal(gitInstallationRoot("C:\\Program Files\\Git\\libexec\\git-core"), "C:\\Program Files\\Git");
	assert.equal(gitInstallationRoot("C:\\Program Files\\Git"), null);
	assert.equal(gitInstallationRoot(null), null);
});
