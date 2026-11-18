// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Sumit Patel

/**
 * A v4 UUID. `crypto.randomUUID` exists only in secure contexts, and a tailnet over plain
 * HTTP is not one; `getRandomValues` exists everywhere (#1181).
 */
export const randomId = (): string =>
	typeof crypto.randomUUID === "function"
		? crypto.randomUUID()
		: "10000000-1000-4000-8000-100000000000".replace(/[018]/g, (c) =>
				(
					+c ^
					(crypto.getRandomValues(new Uint8Array(1))[0] & (15 >> (+c / 4)))
				).toString(16),
			);
