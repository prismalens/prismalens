// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Sumit Patel

import { createHmac, timingSafeEqual } from "node:crypto";

function hexEquals(expected: string, given: string): boolean {
	const a = Buffer.from(expected, "utf8");
	const b = Buffer.from(given, "utf8");
	return a.length === b.length && timingSafeEqual(a, b);
}

/** Sentry: `Sentry-Hook-Signature` is the hex HMAC-SHA256 of the raw body under the integration's client secret. */
export function verifySentrySignature(
	secret: string,
	rawBody: Buffer,
	header: string | undefined,
): boolean {
	if (!header) return false;
	const digest = createHmac("sha256", secret).update(rawBody).digest("hex");
	return hexEquals(digest, header.trim());
}

/** PagerDuty v3: `X-PagerDuty-Signature` is `v1=<hex>[,v1=<hex>]`, any one of which may match (secret rotation). */
export function verifyPagerDutySignature(
	secret: string,
	rawBody: Buffer,
	header: string | undefined,
): boolean {
	if (!header) return false;
	const digest = createHmac("sha256", secret).update(rawBody).digest("hex");
	return header
		.split(",")
		.map((part) => part.trim())
		.filter((part) => part.startsWith("v1="))
		.some((part) => hexEquals(digest, part.slice(3)));
}
