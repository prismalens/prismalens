// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Sumit Patel

import { describe, expect, it } from "vitest";
import { PlConfigSchema } from "../config/schema.js";
import { checkListenToken } from "./doctor.js";

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
