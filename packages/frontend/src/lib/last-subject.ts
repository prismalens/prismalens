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

/** The folder name or repo name at the end of a project's full name. */
const lastSegment = (fullName: string) =>
	fullName.split(/[\\/]/).filter(Boolean).pop()?.toLowerCase() ?? "";

/**
 * A project that an alert reached got a service of the same name linked only to it. That
 * service is the project, so the subject menu lists it once, under Projects.
 */
export function serviceIsProject(
	service: { name: string; repositories?: { repositoryId: string }[] },
	projects: { id: string; fullName: string }[],
): boolean {
	const links = service.repositories ?? [];
	const only = links.length === 1 ? links[0] : undefined;
	const project = only && projects.find((p) => p.id === only.repositoryId);
	return (
		!!project && lastSegment(project.fullName) === service.name.toLowerCase()
	);
}

/**
 * The service the subject menu folds into project `projectId`, so the project's entry can still
 * open an incident, which only a service carries.
 */
export function serviceOfProject<
	S extends { name: string; repositories?: { repositoryId: string }[] },
>(
	services: S[],
	projects: { id: string; fullName: string }[],
	projectId: string | undefined,
): S | undefined {
	return projectId
		? services.find(
				(s) =>
					serviceIsProject(s, projects) &&
					s.repositories?.[0]?.repositoryId === projectId,
			)
		: undefined;
}

/** With one project and no subject chosen, that project: nothing else could be meant. */
export function onlyProject<T extends { id: string }>(
	projects: T[],
	chosen: {
		project?: string;
		service?: string;
		none?: boolean;
		incident?: boolean;
	},
): T | undefined {
	return projects.length === 1 &&
		!chosen.project &&
		!chosen.service &&
		!chosen.none &&
		!chosen.incident
		? projects[0]
		: undefined;
}
