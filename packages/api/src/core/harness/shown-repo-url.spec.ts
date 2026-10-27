// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Sumit Patel

import { describe, expect, it } from "vitest";
import { shownRepoUrl, UNSHOWN_REPO } from "./git-credential.js";

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
	])("%s is never echoed", (_name, stored) => {
		expect(shownRepoUrl("url", stored)).toBe(UNSHOWN_REPO);
	});

	it("a folder is shown as stored", () => {
		expect(shownRepoUrl("folder", "/srv/code/api")).toBe("/srv/code/api");
	});
});
