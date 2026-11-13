import assert from "node:assert/strict";
import { test } from "node:test";

import { isAbsolutePath, samePathKey, trimTrailingSeparators } from "../src/core/paths.ts";

test("isAbsolutePath: le forme POSIX e Windows valgono tutte", () => {
	assert.equal(isAbsolutePath("/home/utente/repo"), true);
	assert.equal(isAbsolutePath("C:\\Users\\utente\\repo"), true);
	assert.equal(isAbsolutePath("C:/Users/utente/repo"), true);
	assert.equal(isAbsolutePath("\\\\server\\share\\repo"), true);
});

test("isAbsolutePath: relativo, opzioni e vuoti non lo sono", () => {
	assert.equal(isAbsolutePath("repo"), false);
	assert.equal(isAbsolutePath("../repo"), false);
	assert.equal(isAbsolutePath("~/repo"), false);
	assert.equal(isAbsolutePath("--upload-pack=evil"), false);
	assert.equal(isAbsolutePath("C:"), false);
	assert.equal(isAbsolutePath(""), false);
});

test("trimTrailingSeparators: toglie le barre finali e conserva le radici", () => {
	assert.equal(trimTrailingSeparators("/home/utente/repo/"), "/home/utente/repo");
	assert.equal(trimTrailingSeparators("/home/utente/repo///"), "/home/utente/repo");
	assert.equal(trimTrailingSeparators("C:\\Users\\utente\\repo\\"), "C:\\Users\\utente\\repo");
	assert.equal(trimTrailingSeparators("C:\\Users\\utente\\repo/"), "C:\\Users\\utente\\repo");
	assert.equal(trimTrailingSeparators("/"), "/");
	assert.equal(trimTrailingSeparators("C:\\"), "C:\\");
});

test("samePathKey: separatori uniformi, maiuscole solo su Windows", () => {
	assert.equal(samePathKey("C:\\repo\\sub\\", "win32"), "c:/repo/sub");
	assert.equal(samePathKey("C:/repo/sub", "win32"), "c:/repo/sub");
	assert.equal(samePathKey("/home/Repo", "linux"), "/home/Repo");
	assert.equal(samePathKey("/home/Repo/", "linux"), "/home/Repo");
});
