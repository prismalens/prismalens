// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Sumit Patel

import { describe, expect, it } from "vitest";
import {
	LOOPBACK_REDIRECT_URI,
	needsDisclosure,
	oauthEndpoints,
	parseGrantedScopes,
	shippedAppFor,
} from "./oauth-apps.js";
import { sourceType } from "./source-type.js";

describe("oauth-apps (#848)", () => {
	const github = sourceType("github-token")!;
	const gitlab = sourceType("gitlab-token")!;
	const bitbucket = sourceType("bitbucket-token")!;

	it("returns null for all three descriptors on their cloud URLs when apps is {}", () => {
		expect(shippedAppFor(github, "https://api.github.com", {})).toBeNull();
		expect(shippedAppFor(gitlab, "https://gitlab.com/api/v4", {})).toBeNull();
		expect(shippedAppFor(bitbucket, "https://api.bitbucket.org/2.0", {})).toBeNull();
	});

	it("returns shipped app on cloud URL and null on custom origin when apps has gitlab", () => {
		const apps = { gitlab: { clientId: "gl-id" } };
		expect(shippedAppFor(gitlab, "https://gitlab.com/api/v4", apps)).toEqual({
			clientId: "gl-id",
		});
		expect(shippedAppFor(gitlab, "https://gitlab.acme.io/api/v4", apps)).toBeNull();
	});

	it("returns null when clientId is empty", () => {
		const apps = { github: { clientId: "" } };
		expect(shippedAppFor(github, "https://api.github.com", apps)).toBeNull();
	});

	it("resolves oauthEndpoints relative to source origin for gitlab and keeps github unchanged", () => {
		expect(oauthEndpoints(gitlab, "https://gitlab.acme.io/api/v4")).toEqual({
			authorizationUrl: "https://gitlab.acme.io/oauth/authorize",
			tokenUrl: "https://gitlab.acme.io/oauth/token",
		});
		expect(oauthEndpoints(github, "https://api.github.com")).toEqual({
			authorizationUrl: "https://github.com/login/oauth/authorize",
			tokenUrl: "https://github.com/login/oauth/access_token",
		});
	});

	it("a GitHub Enterprise Server URL signs in at that host, never github.com", () => {
		expect(oauthEndpoints(github, "https://github.acme.io/api/v3")).toEqual({
			authorizationUrl: "https://github.acme.io/login/oauth/authorize",
			tokenUrl: "https://github.acme.io/login/oauth/access_token",
		});
	});

	it("checks needsDisclosure rule across providers and scopes", () => {
		expect(needsDisclosure(gitlab, ["read_api", "read_repository"])).toBe(false);
		expect(needsDisclosure(gitlab, ["api"])).toBe(true);
		expect(needsDisclosure(github, ["repo"])).toBe(true);
		expect(needsDisclosure(bitbucket, null)).toBe(true);
		expect(needsDisclosure(bitbucket, [])).toBe(true);
		expect(needsDisclosure(gitlab, null)).toBe(true);
	});

	it("parses granted scopes separated by commas or spaces, returning null on empty", () => {
		expect(parseGrantedScopes("repo,gist")).toEqual(["repo", "gist"]);
		expect(parseGrantedScopes("read_api read_repository")).toEqual([
			"read_api",
			"read_repository",
		]);
		expect(parseGrantedScopes("")).toBeNull();
		expect(parseGrantedScopes(undefined)).toBeNull();
	});

	it("pins LOOPBACK_REDIRECT_URI", () => {
		expect(LOOPBACK_REDIRECT_URI).toBe("http://127.0.0.1:6474/callback");
	});
});
