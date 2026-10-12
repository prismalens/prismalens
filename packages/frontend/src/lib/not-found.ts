// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Sumit Patel

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** A 404, or an id that is no record id at all (the API refuses it as a bad request). */
export function isNotFound(error: unknown, id: string): boolean {
	if (!UUID.test(id)) return true;
	return (
		typeof error === "object" &&
		error !== null &&
		"status" in error &&
		(error as { status?: number }).status === 404
	);
}
