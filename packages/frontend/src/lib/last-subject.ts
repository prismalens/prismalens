// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Sumit Patel

import type { ThreadStartSubject } from "@prismalens/contracts";

/** Per browser, like recent project sources: a convenience, never a default (#1101). */
const KEY = "pl.lastSubject";

export function rememberSubject(subject: ThreadStartSubject): void {
	const value =
		subject.kind === "project"
			? `project:${subject.repositoryId}`
			: subject.kind === "service"
				? `service:${subject.serviceId}`
				: null;
	if (!value) return;
	try {
		localStorage.setItem(KEY, value);
	} catch {}
}

export function lastSubject(): string | null {
	try {
		return localStorage.getItem(KEY);
	} catch {
		return null;
	}
}

interface Named {
	id: string;
	name: string;
}

/**
 * The subject menu's order: the last-used project or service first, so picking
 * it again is one click; it leaves its own group. A stale value is ignored.
 */
export function subjectMenu(
	projects: Named[],
	services: Named[],
	last: string | null,
): {
	first: { value: string; name: string } | null;
	projects: Named[];
	services: Named[];
} {
	const [kind, id] = last?.split(":") ?? [];
	const list =
		kind === "project" ? projects : kind === "service" ? services : [];
	const hit = list.find((x) => x.id === id);
	if (!hit) return { first: null, projects, services };
	return {
		first: { value: `${kind}:${hit.id}`, name: hit.name },
		projects: kind === "project" ? projects.filter((p) => p !== hit) : projects,
		services: kind === "service" ? services.filter((s) => s !== hit) : services,
	};
}
