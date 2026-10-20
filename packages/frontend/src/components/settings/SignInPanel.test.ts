// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Sumit Patel

import { DISCLOSURE, sourceType } from "@prismalens/contracts/schemas";
import { describe, expect, it } from "vitest";
import { disclosureFor } from "./SignInPanel";

const type = (id: string) => {
	const t = sourceType(id);
	if (!t) throw new Error(id);
	return t;
};

describe("the disclosure line (#848, OBJ-013)", () => {
	it("GitLab read_api read_repository shows no line", () => {
		expect(disclosureFor(type("gitlab-token"), "oauth", ["read_api", "read_repository"])).toBeNull();
	});
	it("GitLab api shows it", () => {
		expect(disclosureFor(type("gitlab-token"), "oauth", ["api"])).toBe(DISCLOSURE.signIn);
	});
	it("any GitHub grant shows it", () => {
		expect(disclosureFor(type("github-token"), "oauth", ["repo"])).toBe(DISCLOSURE.signIn);
	});
	it("a Bitbucket response with no scope shows it", () => {
		expect(disclosureFor(type("bitbucket-token"), "oauth", null)).toBe(DISCLOSURE.signIn);
	});
	it("a pasted token says this token; a source with no sign-in says nothing", () => {
		expect(disclosureFor(type("gitlab-token"), "bearer", null)).toBe(DISCLOSURE.token);
		expect(disclosureFor(type("prometheus"), "bearer", null)).toBeNull();
	});
	it("an MCP server always shows it unless it takes no credential", () => {
		expect(disclosureFor(type("mcp-server"), "bearer", null)).toBe(DISCLOSURE.token);
		expect(disclosureFor(type("mcp-server"), "mcp-oauth", ["a"])).toBe(DISCLOSURE.signIn);
		expect(disclosureFor(type("mcp-server"), "none", null)).toBeNull();
	});
});
