// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Sumit Patel

/** `CheckoutLatencyHigh` reads as "Checkout latency high"; titles with spaces stay as written. */
export function readableTitle(title: string): string {
	if (/\s/.test(title) || !/[a-z][A-Z]/.test(title)) return title;
	const words = title
		.replace(/([a-z0-9])([A-Z])/g, "$1 $2")
		.replace(/([A-Z]+)([A-Z][a-z])/g, "$1 $2")
		.split(" ");
	return words
		.map((w, i) => (i === 0 || /^[A-Z0-9]{2,}$/.test(w) ? w : w.toLowerCase()))
		.join(" ");
}
