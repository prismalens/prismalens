// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Sumit Patel

import { afterEach, describe, expect, it } from "vitest";
import { randomId } from "./random-id";

describe("randomId (#1181)", () => {
	const originalRandomUUID = crypto.randomUUID;

	afterEach(() => {
		Object.defineProperty(crypto, "randomUUID", {
			value: originalRandomUUID,
			writable: true,
			configurable: true,
		});
	});

	it("with crypto.randomUUID removed, randomId() returns a v4 UUID string", () => {
		Object.defineProperty(crypto, "randomUUID", {
			value: undefined,
			writable: true,
			configurable: true,
		});

		const id = randomId();
		const uuidV4Regex =
			/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
		expect(id).toMatch(uuidV4Regex);
	});

	it("returns a v4 UUID string with standard crypto.randomUUID available", () => {
		const id = randomId();
		const uuidV4Regex =
			/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
		expect(id).toMatch(uuidV4Regex);
	});
});
