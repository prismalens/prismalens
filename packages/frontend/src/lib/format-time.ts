// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Sumit Patel

const dateTime = new Intl.DateTimeFormat(undefined, {
	dateStyle: "medium",
	timeStyle: "short",
});
const dateOnly = new Intl.DateTimeFormat(undefined, { dateStyle: "medium" });

/** One absolute timestamp format for the whole app: `3 Aug 2026, 11:00`. */
export function formatDateTime(value: string | number | Date): string {
	return dateTime.format(new Date(value));
}

export function formatDate(value: string | number | Date): string {
	return dateOnly.format(new Date(value));
}
