// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Sumit Patel

/**
 * An incident with nothing to show yet (#1020): no alert, run, note or change read. Its page
 * earns no card; it says Nothing yet and offers Link service and the composer.
 */
export function isBlankIncident(f: {
	alerts: number;
	runs: number;
	changes: number;
	deploy: boolean;
	/** Timeline entries other than the incident's creation. */
	entries: number;
}): boolean {
	return (
		f.alerts === 0 &&
		f.runs === 0 &&
		f.changes === 0 &&
		!f.deploy &&
		f.entries === 0
	);
}
