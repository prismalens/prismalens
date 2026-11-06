// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Sumit Patel

import { describe, expect, it } from "vitest";
import { nameFromSource } from "./ServiceFormDialog";

describe("nameFromSource", () => {
	it.each([
		["~/code/payments-api", "payments-api"],
		["C:\\src\\Checkout API\\", "checkout-api"],
		["https://github.com/acme/booklogr.git", "booklogr"],
		["git@github.com:acme/Web_App.git", "web-app"],
		["", ""],
	])("%s gives %s", (source, name) => {
		expect(nameFromSource(source)).toBe(name);
	});
});
