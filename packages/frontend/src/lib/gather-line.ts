// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Sumit Patel

export const alertsWord = (n: number) =>
	n === 0 ? "no alerts" : n === 1 ? "1 alert" : `${n} alerts`;

/** `a`, `a and b`, `a, b and c`. */
function listed(parts: string[]): string {
	if (parts.length < 2) return parts.join("");
	return `${parts.slice(0, -1).join(", ")} and ${parts.at(-1)}`;
}

/** The transcript's first line: what the run gathered, then which agent it started. */
export function gatherLine(r: {
	chat: boolean;
	alerts: number;
	code: string | undefined;
	telemetry: string[];
	agent: string;
}): string {
	if (r.chat)
		return `Started ${r.agent} with your message; nothing was gathered.`;
	const parts = [
		alertsWord(r.alerts),
		r.code ? `the code at ${r.code}` : "no code",
		...r.telemetry,
	];
	return `Gathered ${listed(parts)}, then started ${r.agent}.`;
}
