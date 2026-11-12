// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Sumit Patel

import { isAbsolute, relative, resolve } from "node:path";
import {
	type CanonicalEvent,
	CanonicalEventSchema,
	REFERENCE_SNAPSHOT_MAX_CHARS,
	type ReferenceKind,
	type ReferenceRef,
	type ReferenceSnapshot,
} from "@prismalens/contracts";
import type { PrismaService } from "../../core/prisma/prisma.service.js";
import { FileLister } from "./file-list.js";
import { matchTier } from "./ranking.js";
import type {
	ReferenceCandidate,
	ReferenceContext,
	ReferenceProvider,
	SnapshotContext,
} from "./reference-provider.js";

const TAKE = 50;
/** Titles read per page, and the most a search reads, when it looks for acronym matches. */
const SCAN_PAGE = 1000;
const SCAN_MAX = 20_000;

/**
 * The rows matching `q` as a substring, plus the newest rows, plus older rows whose title
 * `q` is an acronym of: `pdw` is no substring of "PR desk: Wave 1", and the newest rows
 * may not include it, so every title is read (id and title only) and matched in memory (#1024).
 */
async function matchedOrRecent<T extends { id: string }>(
	q: string,
	read: (filter: boolean) => Promise<T[]>,
	titles: (skip: number) => Promise<{ id: string; title: string | null }[]>,
	byId: (ids: string[]) => Promise<T[]>,
): Promise<T[]> {
	if (!q) return read(false);
	const [matched, recent] = await Promise.all([read(true), read(false)]);
	const rows = [...matched];
	const seen = new Set(rows.map((r) => r.id));
	for (const r of recent)
		if (!seen.has(r.id)) {
			rows.push(r);
			seen.add(r.id);
		}
	const older: string[] = [];
	for (
		let skip = 0;
		skip < SCAN_MAX && older.length < TAKE;
		skip += SCAN_PAGE
	) {
		const page = await titles(skip);
		for (const t of page) {
			const tier = matchTier(q, t.title || "")?.tier;
			if (tier && tier <= 3 && !seen.has(t.id)) older.push(t.id);
		}
		if (page.length < SCAN_PAGE) break;
	}
	if (older.length) rows.push(...(await byId(older.slice(0, TAKE))));
	return rows;
}

const RUNNING = new Set(["pending", "running"]);

/** The run a snapshot is sent into: what it is about, so a record outside it goes as snapshot only. */
export interface RunScope {
	threadId: string | null;
	incidentId: string | null;
	repositoryId: string | null;
	serviceId: string | null;
	scheduleId: string | null;
	root: string | null;
}

function cut(text: string): string {
	return text.length > REFERENCE_SNAPSHOT_MAX_CHARS
		? `${text.slice(0, REFERENCE_SNAPSHOT_MAX_CHARS - 1)}…`
		: text;
}

/** The last thing the agent said in a run, from its stored events. */
export function lastAnswer(events: CanonicalEvent[]): string | null {
	for (let i = events.length - 1; i >= 0; i--) {
		const e = events[i];
		if (e?.kind === "agent_step" && e.text.trim()) return e.text.trim();
	}
	return null;
}

/** A path inside `root`, never outside it. */
export function insideRoot(root: string, path: string): string | null {
	const abs = resolve(root, path);
	const rel = relative(root, abs);
	return rel.startsWith("..") || isAbsolute(rel) ? null : abs;
}

/**
 * PrismaLens's own records and the workspace's files (#1024): what `@` mentions and
 * `#` finds by number. Each resolves to a bounded snapshot at send time.
 */
export class RecordsProvider implements ReferenceProvider {
	readonly source = "PrismaLens";
	readonly kinds: readonly ReferenceKind[] = [
		"file",
		"folder",
		"thread",
		"incident",
		"service",
		"project",
		"schedule",
		"attachment",
		"artifact",
		"alert",
	];

	constructor(
		private readonly prisma: PrismaService,
		readonly files = new FileLister(),
	) {}

	async search(
		q: string,
		ctx: ReferenceContext,
	): Promise<ReferenceCandidate[]> {
		const want = new Set(ctx.kinds);
		const like = q.trim() ? { contains: q.trim() } : undefined;
		const out: ReferenceCandidate[] = [];
		const jobs: Promise<void>[] = [];
		if ((want.has("file") || want.has("folder")) && ctx.root) {
			const root = ctx.root;
			jobs.push(
				this.files.list(root).then((list) => {
					for (const p of list.paths) {
						const folder = p.endsWith("/");
						if (!want.has(folder ? "folder" : "file")) continue;
						const name = p.replace(/\/$/, "").split("/").pop() ?? p;
						out.push({
							ref: { kind: folder ? "folder" : "file", id: p, label: name },
							detail: p,
							group: "Files",
						});
					}
				}),
			);
		}
		if (want.has("thread"))
			jobs.push(
				matchedOrRecent(
					q.trim(),
					(filter) =>
						this.prisma.investigation.findMany({
							where: {
								...(filter && like ? { title: like } : {}),
								...(ctx.threadId ? { id: { not: ctx.threadId } } : {}),
							},
							orderBy: { updatedAt: "desc" },
							take: TAKE,
							select: {
								id: true,
								title: true,
								status: true,
								kind: true,
								updatedAt: true,
							},
						}),
					(skip) =>
						this.prisma.investigation.findMany({
							where: ctx.threadId ? { id: { not: ctx.threadId } } : {},
							orderBy: { updatedAt: "desc" },
							skip,
							take: SCAN_PAGE,
							select: { id: true, title: true },
						}),
					(ids) =>
						this.prisma.investigation.findMany({
							where: { id: { in: ids } },
							orderBy: { updatedAt: "desc" },
							select: {
								id: true,
								title: true,
								status: true,
								kind: true,
								updatedAt: true,
							},
						}),
				).then((rows) => {
					for (const r of rows)
						out.push({
							ref: {
								kind: "thread",
								id: r.id,
								label: (r.title || "Untitled thread").slice(0, 200),
							},
							detail: r.status,
							group: "Threads",
							active: RUNNING.has(r.status),
							at: r.updatedAt.getTime(),
						});
				}),
			);
		if (want.has("incident"))
			jobs.push(
				matchedOrRecent(
					q.trim(),
					(filter) =>
						this.prisma.incident.findMany({
							where: filter && like ? { title: like } : {},
							orderBy: { createdAt: "desc" },
							take: TAKE,
							select: {
								id: true,
								number: true,
								title: true,
								status: true,
								createdAt: true,
							},
						}),
					(skip) =>
						this.prisma.incident.findMany({
							orderBy: { createdAt: "desc" },
							skip,
							take: SCAN_PAGE,
							select: { id: true, title: true },
						}),
					(ids) =>
						this.prisma.incident.findMany({
							where: { id: { in: ids } },
							orderBy: { createdAt: "desc" },
							select: {
								id: true,
								number: true,
								title: true,
								status: true,
								createdAt: true,
							},
						}),
				).then((rows) => {
					for (const { createdAt, ...r } of rows)
						out.push({ ...incidentHit(r), at: createdAt.getTime() });
				}),
			);
		if (want.has("service"))
			jobs.push(
				this.prisma.service
					.findMany({
						where: like ? { OR: [{ name: like }, { displayName: like }] } : {},
						take: TAKE,
						select: { id: true, name: true, displayName: true },
					})
					.then((rows) => {
						for (const r of rows)
							out.push({
								ref: {
									kind: "service",
									id: r.id,
									label: (r.displayName || r.name).slice(0, 200),
								},
								detail: r.name,
								group: "Services",
							});
					}),
			);
		if (want.has("project"))
			jobs.push(
				this.prisma.repository
					.findMany({
						where: like ? { fullName: like } : {},
						take: TAKE,
						select: { id: true, fullName: true, url: true },
					})
					.then((rows) => {
						for (const r of rows)
							out.push({
								ref: {
									kind: "project",
									id: r.id,
									label: r.fullName.slice(0, 200),
								},
								detail: r.url.slice(0, 300),
								group: "Projects",
							});
					}),
			);
		if (want.has("schedule"))
			jobs.push(
				this.prisma.schedule
					.findMany({
						where: like ? { name: like } : {},
						take: TAKE,
						select: { id: true, name: true, enabled: true },
					})
					.then((rows) => {
						for (const r of rows)
							out.push({
								ref: {
									kind: "schedule",
									id: r.id,
									label: r.name.slice(0, 200),
								},
								detail: r.enabled ? "on" : "paused",
								group: "Schedules",
							});
					}),
			);
		if (want.has("attachment") && ctx.threadId)
			jobs.push(
				this.prisma.attachment
					.findMany({
						where: {
							investigationId: ctx.threadId,
							...(like ? { name: like } : {}),
						},
						take: TAKE,
						select: { id: true, name: true, mimeType: true },
					})
					.then((rows) => {
						for (const r of rows)
							out.push({
								ref: {
									kind: "attachment",
									id: r.id,
									label: r.name.slice(0, 200),
								},
								detail: r.mimeType,
								group: "Attachments",
							});
					}),
			);
		if (want.has("artifact") && ctx.threadId)
			jobs.push(
				this.events(ctx.threadId, "artifact_published").then((events) => {
					for (const e of events)
						if (e.kind === "artifact_published")
							out.push({
								ref: {
									kind: "artifact",
									id: `${ctx.threadId}/${e.artifact.id}`,
									label: e.artifact.title.slice(0, 200),
								},
								group: "Artifacts",
							});
				}),
			);
		if (want.has("alert"))
			jobs.push(
				this.prisma.alert
					.findMany({
						where: like ? { title: like } : {},
						orderBy: { createdAt: "desc" },
						take: TAKE,
						select: { id: true, title: true, status: true },
					})
					.then((rows) => {
						for (const r of rows)
							out.push({
								ref: { kind: "alert", id: r.id, label: r.title.slice(0, 200) },
								detail: r.status,
								group: "Stored alerts",
							});
					}),
			);
		await Promise.all(jobs);
		return out;
	}

	async byNumber(
		n: number,
		ctx: ReferenceContext,
	): Promise<ReferenceCandidate[]> {
		if (!ctx.kinds.includes("incident")) return [];
		const r = await this.prisma.incident.findFirst({
			where: { number: n },
			select: { id: true, number: true, title: true, status: true },
		});
		return r ? [incidentHit(r)] : [];
	}

	async snapshot(
		ref: ReferenceRef,
		ctx: SnapshotContext,
	): Promise<ReferenceSnapshot | null> {
		const scope = await this.scopeOf(ctx);
		return this.snapshotIn(ref, scope);
	}

	/** The run's subject, for deciding what is in its scope. */
	async scopeOf(ctx: SnapshotContext): Promise<RunScope> {
		const run = ctx.threadId
			? await this.prisma.investigation.findUnique({
					where: { id: ctx.threadId },
					select: {
						incidentId: true,
						repositoryId: true,
						serviceId: true,
						scheduleId: true,
					},
				})
			: null;
		return {
			threadId: ctx.threadId,
			incidentId: run?.incidentId ?? ctx.incidentId ?? null,
			repositoryId: run?.repositoryId ?? ctx.repositoryId ?? null,
			serviceId: run?.serviceId ?? ctx.serviceId ?? null,
			scheduleId: run?.scheduleId ?? null,
			root: ctx.root,
		};
	}

	async snapshotIn(
		ref: ReferenceRef,
		scope: RunScope,
	): Promise<ReferenceSnapshot | null> {
		switch (ref.kind) {
			case "file":
			case "folder": {
				const abs = scope.root ? insideRoot(scope.root, ref.id) : null;
				if (!abs)
					return {
						ref,
						text: `${ref.kind === "file" ? "File" : "Folder"} ${ref.id} (not in this run's workspace).`,
						outOfScope: true,
					};
				return {
					ref,
					text: `${ref.kind === "file" ? "File" : "Folder"}: ${abs}`,
					outOfScope: false,
				};
			}
			case "thread": {
				const t = await this.prisma.investigation.findUnique({
					where: { id: ref.id },
					select: {
						id: true,
						title: true,
						status: true,
						incidentId: true,
						repositoryId: true,
						serviceId: true,
						summary: true,
					},
				});
				if (!t) return null;
				const inScope =
					(!!t.incidentId && t.incidentId === scope.incidentId) ||
					(!!t.repositoryId && t.repositoryId === scope.repositoryId) ||
					(!!t.serviceId && t.serviceId === scope.serviceId);
				const answer = t.summary ?? lastAnswer(await this.events(t.id));
				return {
					ref,
					text: cut(
						[
							`Thread "${t.title ?? "Untitled"}" (${t.id}), ${t.status}.`,
							answer ? `Last answer:\n${answer}` : "No answer yet.",
						].join("\n"),
					),
					outOfScope: !inScope,
					...(inScope ? { readTool: "pl_thread_read" } : {}),
				};
			}
			case "incident": {
				const i = await this.prisma.incident.findUnique({
					where: { id: ref.id },
					select: {
						id: true,
						number: true,
						title: true,
						severity: true,
						status: true,
						investigations: {
							where: { rootCause: { not: null } },
							orderBy: { completedAt: "desc" },
							take: 1,
							select: { rootCause: true },
						},
					},
				});
				if (!i) return null;
				const inScope = scope.incidentId === i.id;
				const cause = i.investigations[0]?.rootCause;
				return {
					ref,
					text: cut(
						[
							`Incident INC-${i.number}: ${i.title}. Severity ${i.severity}, ${i.status}.`,
							cause ? `Cause: ${cause}` : "No reported cause yet.",
						].join("\n"),
					),
					outOfScope: !inScope,
					...(inScope ? { readTool: "pl_incident_get" } : {}),
				};
			}
			case "service": {
				const s = await this.prisma.service.findUnique({
					where: { id: ref.id },
					select: {
						id: true,
						name: true,
						displayName: true,
						repositories: {
							select: { repository: { select: { fullName: true, url: true } } },
						},
					},
				});
				if (!s) return null;
				const repos = s.repositories.map(
					(r) => `${r.repository.fullName} (${r.repository.url})`,
				);
				return {
					ref,
					text: cut(
						`Service ${s.displayName || s.name} (${s.name}). Repositories: ${repos.join(", ") || "none"}.`,
					),
					outOfScope: scope.serviceId !== s.id,
				};
			}
			case "project": {
				const r = await this.prisma.repository.findUnique({
					where: { id: ref.id },
					select: { id: true, fullName: true, url: true },
				});
				if (!r) return null;
				return {
					ref,
					text: cut(`Project ${r.fullName}: ${r.url}`),
					outOfScope: scope.repositoryId !== r.id,
				};
			}
			case "schedule": {
				const s = await this.prisma.schedule.findUnique({
					where: { id: ref.id },
					select: { id: true, name: true, brief: true, recurrence: true },
				});
				if (!s) return null;
				return {
					ref,
					text: cut(
						`Scheduled prompt "${s.name}". Recurrence: ${s.recurrence}.\nBrief:\n${s.brief}`,
					),
					outOfScope: scope.scheduleId !== s.id,
				};
			}
			case "attachment": {
				const a = await this.prisma.attachment.findUnique({
					where: { id: ref.id },
					select: {
						id: true,
						name: true,
						mimeType: true,
						size: true,
						investigationId: true,
					},
				});
				if (!a) return null;
				const own = !!scope.threadId && a.investigationId === scope.threadId;
				return {
					ref,
					text: `Attachment ${a.name} (${a.mimeType}, ${a.size} bytes), id ${a.id}.`,
					outOfScope: !own,
					...(own ? { readTool: "pl_attachment_read" } : {}),
				};
			}
			case "artifact": {
				const [threadId, artifactId] = ref.id.split("/");
				if (!threadId || !artifactId) return null;
				const page = (await this.events(threadId, "artifact_published")).find(
					(e) =>
						e.kind === "artifact_published" && e.artifact.id === artifactId,
				);
				if (page?.kind !== "artifact_published") return null;
				return {
					ref,
					text: cut(
						`Artifact "${page.artifact.title}" published in thread ${threadId}.`,
					),
					outOfScope: threadId !== scope.threadId,
				};
			}
			case "alert": {
				const a = await this.prisma.alert.findUnique({
					where: { id: ref.id },
					select: {
						title: true,
						status: true,
						severity: true,
						labels: true,
						description: true,
						triggeredAt: true,
						sourceUrl: true,
					},
				});
				if (!a) return null;
				return {
					ref,
					text: cut(
						[
							`Alert "${a.title}", ${a.severity}, ${a.status}, since ${a.triggeredAt.toISOString()}.`,
							`Labels: ${a.labels ?? "{}"}`,
							a.description ? `Description: ${a.description}` : "",
							a.sourceUrl ? `Source: ${a.sourceUrl}` : "",
						]
							.filter(Boolean)
							.join("\n"),
					),
					outOfScope: false,
				};
			}
			default:
				return null;
		}
	}

	private async events(
		threadId: string,
		kind?: CanonicalEvent["kind"],
	): Promise<CanonicalEvent[]> {
		const rows = await this.prisma.investigationEvent.findMany({
			where: {
				investigationId: threadId,
				...(kind ? { event: { contains: `"kind":"${kind}"` } } : {}),
			},
			orderBy: { seq: "asc" },
			select: { event: true },
		});
		const out: CanonicalEvent[] = [];
		for (const r of rows) {
			const p = CanonicalEventSchema.safeParse(JSON.parse(r.event));
			if (p.success) out.push(p.data);
		}
		return out;
	}
}

function incidentHit(r: {
	id: string;
	number: number;
	title: string;
	status: string;
}): ReferenceCandidate {
	return {
		ref: {
			kind: "incident",
			id: r.id,
			label: `INC-${r.number} ${r.title}`.slice(0, 200),
		},
		detail: r.status,
		group: "Incidents",
	};
}
