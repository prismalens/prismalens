// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Sumit Patel

/**
 * Whether the app-boot smoke retries a failed fetch once. Windows runners reuse
 * a pooled socket the server closed (ECONNRESET, #742); macOS on Node 24 can
 * fail setting the socket's type of service (EINVAL from setTypeOfService, #902).
 * Never the one-use pairing redeem: the reset POST may already have spent its token.
 */
export function retryableFetchError(error, url) {
	if (String(url).endsWith("/api/pairing/redeem")) return null;
	const cause = error?.cause;
	if (cause?.code === "ECONNRESET") return "ECONNRESET";
	if (
		cause?.code === "EINVAL" &&
		/setTypeOfService/.test(
			`${cause.stack ?? ""} ${cause.message ?? ""} ${error?.stack ?? ""}`,
		)
	)
		return "EINVAL setTypeOfService";
	return null;
}
