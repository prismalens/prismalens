// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Sumit Patel

import { describe, expect, it } from "vitest";
import { shownRepoName, shownRepoUrl, shownText, UNSHOWN_REPO } from "./git-credential.js";
import { displayNameFor } from "./repo-source.service.js";

const SENTINEL = "ghp_SENTINEL938";

describe("shownRepoUrl (#938)", () => {
	it.each([
		["scp with ?token=", `git@github.com:acme/api.git?token=${SENTINEL}`, "git@github.com:acme/api.git"],
		["https with user:password", `https://x:${SENTINEL}@github.com/acme/api.git`, "https://github.com/acme/api.git"],
		["https with a token as username", `https://${SENTINEL}@github.com/acme/api.git`, "https://github.com/acme/api.git"],
		["https with a query", `https://github.com/acme/api.git?access_token=${SENTINEL}`, "https://github.com/acme/api.git"],
		["https with a fragment", `https://github.com/acme/api.git#${SENTINEL}`, "https://github.com/acme/api.git"],
		["git+https with user:password", `git+https://u:${SENTINEL}@git.example/x`, "git+https://git.example/x"],
		["git+https with a token as username", `git+https://${SENTINEL}@git.example/x`, "git+https://git.example/x"],
		["ssh with a password", `ssh://git:${SENTINEL}@github.com/acme/api.git`, "ssh://git@github.com/acme/api.git"],
	])("%s comes back without the credential", (_name, stored, shown) => {
		const out = shownRepoUrl("url", stored);
		expect(out).not.toContain(SENTINEL);
		expect(out).toBe(shown);
	});

	it.each([
		"https://github.com/acme/api.git",
		"git@github.com:acme/api.git",
		"ssh://git@github.com/acme/api.git",
		"git+ssh://git@github.com/acme/api.git",
	])("%s is shown as stored", (stored) => {
		expect(shownRepoUrl("url", stored)).toBe(stored);
	});

	it.each([
		["scp-like userinfo with a password", `u:${SENTINEL}@github.com:acme/api.git`],
		["an unparsable URL", `https://${SENTINEL}@[bad/x`],
		["neither a URL nor an scp remote", `token=${SENTINEL}`],
		["a URL nested in a URL's path", `https://github.com/https://u:${SENTINEL}@other/x`],
		["a URL nested in an scp path", `git@github.com:https://u:${SENTINEL}@other/x`],
		["an encoded userinfo in a path", `https://github.com/u:${SENTINEL}%40other/x`],
	])("%s is never echoed", (_name, stored) => {
		expect(shownRepoUrl("url", stored)).toBe(UNSHOWN_REPO);
	});

	it("a folder is shown as stored", () => {
		expect(shownRepoUrl("folder", "/srv/code/api")).toBe("/srv/code/api");
	});
});

describe("shownRepoName and shownText (#938)", () => {
	it.each([
		["a legacy root address", `https://github.com/?token=${SENTINEL}`, "https://github.com/"],
		["a name with a query", `acme/api?token=${SENTINEL}`, UNSHOWN_REPO],
		["a name holding userinfo", `u:${SENTINEL}@other/x`, UNSHOWN_REPO],
		["an owner/repo name", "acme/api", "acme/api"],
	])("%s", (_name, stored, shown) => {
		expect(shownRepoName("url", stored)).toBe(shown);
	});

	it("a folder's name is its basename, kept as is", () => {
		expect(shownRepoName("folder", "me@laptop")).toBe("me@laptop");
	});

	it("every address in a pre-#938 note is shown without its credential", () => {
		const note = `Investigating a snapshot of URL https://x:${SENTINEL}@github.com/acme/api at main abc. Not included: URL git@github.com:acme/web.git?token=${SENTINEL} (clone failed); folder /srv/code/x.`;
		const shown = shownText(note);
		expect(shown).not.toContain(SENTINEL);
		expect(shown).toContain("URL https://github.com/acme/api at main");
		expect(shown).toContain("URL git@github.com:acme/web.git (clone failed)");
		expect(shown).toContain("folder /srv/code/x.");
	});

	it("a credential nested in a path never becomes a repository's name", () => {
		const name = displayNameFor("url", `https://github.com/https://u:${SENTINEL}@other`);
		expect(name).not.toContain(SENTINEL);
	});
});

describe("round 3 (#938)", () => {
	it.each([
		["a query with parentheses", `(URL https://github.com/x/y?token=(${SENTINEL})) at main`],
		["a password with an apostrophe", `URL https://u:p'${SENTINEL}@github.com/x/y at main`],
	])("%s leaves no credential in a note", (_name, note) => {
		expect(shownText(note)).not.toContain(SENTINEL);
	});

	it("a folder path in a note is kept byte for byte", () => {
		const note = "Investigating a snapshot of folder /srv/code/u@host:api?draft at main abc.";
		expect(shownText(note)).toBe(note);
	});

	it("scans a 1 MiB note with no address in linear time", () => {
		const started = performance.now();
		shownText("a".repeat(1024 * 1024));
		shownText("x@y:".repeat(256 * 1024));
		expect(performance.now() - started).toBeLessThan(500);
	});

	it("a credential-free path with @ keeps its name", () => {
		expect(shownRepoUrl("url", "https://git.example/acme/api@2.git")).toBe("https://git.example/acme/api@2.git");
		expect(displayNameFor("url", "https://git.example/acme/api@2.git")).toBe("acme/api@2");
	});
});
