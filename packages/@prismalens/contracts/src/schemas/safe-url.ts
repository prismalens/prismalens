// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Sumit Patel

/**
 * An alert's source link comes from the webhook that sent it (Alertmanager's
 * `generatorURL`, a generic sender's `sourceUrl`). Only http and https ever
 * become a link; anything else is kept out of the record at intake and never
 * rendered as one.
 */
export function httpUrlOrNull(value: string | null | undefined): string | null {
	if (!value) return null;
	try {
		const url = new URL(value);
		return url.protocol === "http:" || url.protocol === "https:"
			? url.href
			: null;
	} catch {
		return null;
	}
}
