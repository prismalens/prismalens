// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Sumit Patel

import { describe, expect, it } from "vitest";
import { hostFromApiBaseUrl } from "../../core/harness/git-credential.js";
import { readProbe } from "./sources.service.js";

describe("GitLab and Bitbucket sources (#848)", () => {
	it("derives the clone host from the API base URL", () => {
		expect(hostFromApiBaseUrl("https://gitlab.com/api/v4")).toBe("gitlab.com");
		expect(hostFromApiBaseUrl("https://git.corp:8443/api/v4")).toBe("git.corp:8443");
		expect(hostFromApiBaseUrl("https://api.bitbucket.org/2.0")).toBe("bitbucket.org");
		expect(hostFromApiBaseUrl("nonsense")).toBeNull();
	});

	it("reads a GitLab username, a Bitbucket nickname and a values page", () => {
		expect(readProbe("login", { username: "ada" }).identity).toBe("ada");
		expect(readProbe("login", { nickname: "ada" }).identity).toBe("ada");
		expect(readProbe("count", { values: [{}, {}] }).detail).toBe("2 found");
	});
});
