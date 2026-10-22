// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Sumit Patel

/** Unit tests for retryableFetchError predicate (#902). */
import assert from "node:assert/strict";
import { test } from "node:test";
import { retryableFetchError } from "./app-boot-retry.mjs";

test("returns ECONNRESET for ECONNRESET cause on health endpoint", () => {
	const err = { cause: { code: "ECONNRESET" } };
	assert.equal(
		retryableFetchError(err, "http://127.0.0.1:1/api/health"),
		"ECONNRESET",
	);
});

test("returns EINVAL setTypeOfService when EINVAL cause stack mentions setTypeOfService", () => {
	const err = {
		cause: {
			code: "EINVAL",
			stack: "Error: EINVAL\n    at Socket.setTypeOfService (node:net:123:45)",
		},
	};
	assert.equal(
		retryableFetchError(err, "http://127.0.0.1:1/api/health"),
		"EINVAL setTypeOfService",
	);
});

test("returns null for EINVAL without setTypeOfService", () => {
	const err = {
		cause: {
			code: "EINVAL",
			stack: "Error: EINVAL\n    at otherMethod (node:net:123:45)",
		},
	};
	assert.equal(retryableFetchError(err, "http://127.0.0.1:1/api/health"), null);
});

test("returns null for pairing redeem endpoint on ECONNRESET or EINVAL", () => {
	const resetErr = { cause: { code: "ECONNRESET" } };
	const einvalErr = {
		cause: {
			code: "EINVAL",
			stack: "at Socket.setTypeOfService",
		},
	};
	assert.equal(
		retryableFetchError(resetErr, "http://127.0.0.1:1/api/pairing/redeem"),
		null,
	);
	assert.equal(
		retryableFetchError(einvalErr, "http://127.0.0.1:1/api/pairing/redeem"),
		null,
	);
});

test("returns null for TypeError with no cause", () => {
	const err = new TypeError("fetch failed");
	assert.equal(retryableFetchError(err, "http://127.0.0.1:1/api/health"), null);
});
