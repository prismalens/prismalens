// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Sumit Patel

/** A page the run's alerts or report name, for the panel's Browser tab (#973). */
export interface RunLink {
	url: string;
	label: string;
}

const URL_IN_TEXT = /\bhttps?:\/\/[^\s<>"'`)\]]+/g;
const MAX_LINKS = 20;

function web(raw: string): URL | null {
	try {
		const url = new URL(raw.replace(/[.,;:!?]+$/, ""));
		return url.protocol === "http:" || url.protocol === "https:" ? url : null;
	} catch {
		return null;
	}
}

const shortLabel = (u: URL) =>
	`${u.host}${u.pathname === "/" ? "" : u.pathname}`.replace(/\/$/, "");

export function runLinks(
	alerts: readonly {
		title: string;
		sourceUrl: string | null;
		description: string | null;
		labels: Record<string, string> | null;
	}[],
	report: unknown,
): RunLink[] {
	const out = new Map<string, RunLink>();
	const add = (raw: string, label?: string) => {
		const u = web(raw);
		if (!u || out.has(u.href) || out.size >= MAX_LINKS) return;
		out.set(u.href, { url: u.href, label: label ?? shortLabel(u) });
	};
	for (const a of alerts) {
		if (a.sourceUrl) add(a.sourceUrl, `${a.title}, in its source`);
		for (const m of (a.description ?? "").match(URL_IN_TEXT) ?? []) add(m);
		for (const v of Object.values(a.labels ?? {}))
			for (const m of v.match(URL_IN_TEXT) ?? []) add(m);
	}
	for (const m of JSON.stringify(report ?? "").match(URL_IN_TEXT) ?? [])
		add(m.replace(/\\+$/, ""));
	return Array.from(out.values());
}
