// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Sumit Patel

import { describe, expect, it } from "vitest";
import { agentUrl } from "./browser-host.service.js";

describe("agentUrl (#1061)", () => {
	it("Given a URL without a scheme example.com/x, When agentUrl parses it, Then it prepends https to make https://example.com/x", () => {
		expect(agentUrl("example.com/x")).toEqual(
			new URL("https://example.com/x"),
		);
	});

	it("Given http://localhost:3000/a, When agentUrl parses it, Then it is kept intact", () => {
		expect(agentUrl("http://localhost:3000/a")).toEqual(
			new URL("http://localhost:3000/a"),
		);
	});

	it("Given javascript:alert(1), When agentUrl parses it, Then it returns null", () => {
		expect(agentUrl("javascript:alert(1)")).toBeNull();
	});

	it("Given file:///etc/passwd, When agentUrl parses it, Then it returns null", () => {
		expect(agentUrl("file:///etc/passwd")).toBeNull();
	});

	it("Given data:text/html,x, When agentUrl parses it, Then it returns null", () => {
		expect(agentUrl("data:text/html,x")).toBeNull();
	});

	it("Given https://user:pw@example.com, When agentUrl parses it, Then credentials return null", () => {
		expect(agentUrl("https://user:pw@example.com")).toBeNull();
	});

	it("Given an empty string, When agentUrl parses it, Then it returns null", () => {
		expect(agentUrl("")).toBeNull();
	});
});
