// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Sumit Patel

/**
 * Returns true if the given error represents an EADDRINUSE socket bind error.
 * (#237)
 */
export function isEaddrinuseError(error: unknown): boolean {
	if (typeof error !== "object" || error === null) {
		return false;
	}
	const err = error as { code?: unknown; message?: unknown };
	return (
		err.code === "EADDRINUSE" ||
		(typeof err.message === "string" && err.message.includes("EADDRINUSE"))
	);
}
