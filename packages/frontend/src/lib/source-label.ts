// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Sumit Patel

const CONTEXT_PACK: Record<string, string> = {
	"PRIOR SIMILAR INCIDENTS": "Earlier incidents",
	"SERVICE CONTEXT": "Service",
	ALERTS: "Alert",
	"ALERT PAYLOAD": "Alert",
	TELEMETRY: "Telemetry",
};

const words = (key: string) => key.replace(/[_-]+/g, " ").trim().toLowerCase();

/**
 * A report source in words: the brief's own section names and the alert's
 * field paths (`annotations.summary`) never reach the page (#673).
 */
export function sourceLabel(source: string): string {
	const field = /^(?:alert[\s.:]+)?(annotations|labels)\.([\w-]+)$/i.exec(
		source.trim(),
	);
	if (field?.[1] && field[2]) {
		const what = words(field[2]);
		return field[1].toLowerCase() === "labels"
			? `Alert label ${what}`
			: `Alert ${what}`;
	}
	const m = /^context-pack:\s*(.+)$/i.exec(source.trim());
	if (!m?.[1]) return source;
	const key = m[1].trim().toUpperCase();
	return (
		CONTEXT_PACK[key] ??
		key.charAt(0) + key.slice(1).toLowerCase().replace(/_/g, " ")
	);
}
