// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Sumit Patel

import { describe, expect, it, vi } from "vitest";
import { PlConfigSchema } from "../config/schema.js";
import { checkListenToken, checkCredential } from "./doctor.js";
import { resolveCredentials } from "@prismalens/config/credentials";

vi.mock("@prismalens/config/credentials", () => ({
	resolveCredentials: vi.fn(),
}));

describe("doctor — checkListenToken", () => {
	it("passes when listen.token is configured", () => {
		const config = PlConfigSchema.parse({
			listen: { token: "sometoken" },
		});
		const check = checkListenToken(config);
		expect(check.name).toBe("Listen intake");
		expect(check.pass).toBe(true);
		expect(check.hard).toBe(false);
		expect(check.detail).toContain("token configured");
		expect(check.detail).toContain(config.listen.port.toString());
	});

	it("fails softly when listen.token is unset", () => {
		const config = PlConfigSchema.parse({});
		const check = checkListenToken(config);
		expect(check.name).toBe("Listen intake");
		expect(check.pass).toBe(false);
		expect(check.hard).toBe(false); // Explicitly a soft check
		expect(check.detail).toContain("listen.token is unset");
	});
});

describe("doctor — checkCredential", () => {
	it("reports source: stored when credential source is stored", async () => {
		vi.mocked(resolveCredentials).mockReturnValue({
			source: "stored",
			apiKey: "test-key",
			providerId: "openai",
			baseURL: undefined
		});

		const config = PlConfigSchema.parse({});
		const check = await checkCredential(config, true); // noPing = true
		
		expect(check.name).toBe("LLM credential");
		expect(check.pass).toBe(true);
		expect(check.detail).toContain("source: stored");
	});
});
