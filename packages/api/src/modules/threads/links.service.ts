// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Sumit Patel

/**
 * Which names in the agent's prose exist, and what each opens (#1024 decision 4).
 * A path outside the workspace, a missing thread or an unknown title resolves to null.
 */
import { realpath, stat } from "node:fs/promises";
import { basename, isAbsolute, relative, resolve, sep } from "node:path";
import { Injectable, Optional } from "@nestjs/common";
import { ORPCError } from "@orpc/nest";
import type {
	LinkCandidate,
	LinkTarget,
	RunWorkspace,
} from "@prismalens/contracts";
import {
	CanonicalEventSchema,
	RunWorkspaceSchema,
} from "@prismalens/contracts";
import { PrismaService } from "../../core/prisma/prisma.service.js";
import { safeParseJsonObject } from "../../shared/utils/json-utils.js";
import { ImagesService } from "../images/images.service.js";
import { readWorktreeChanges } from "../investigations/worktree-changes.js";
import { imageFor, pullRequestView } from "./pull-requests.service.js";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export interface PathRef {
	path: string;
	line?: number;
	end?: number;
}

/** `a.ts`, `a.ts:12`, `a.ts:12-20`, `a.ts:12:5` and `a.ts#L12-L20`, as `locate()` reads them. */
export function parsePathRef(text: string): PathRef | null {
	const t = text.trim().replace(/^`|`$/g, "");
	const forms: [RegExp, boolean][] = [
		[/^(.+)#L(\d+)(?:-L?(\d+))?$/, true],
		[/^(.+):(\d+)-(\d+)$/, true],
		// `a.ts:12:5` names a column, not a range end.
		[/^(.+):(\d+):\d+$/, false],
		[/^(.+):(\d+)$/, false],
		[/^(.+)$/, false],
	];
	for (const [re, ranged] of forms) {
		const m = re.exec(t);
		if (!m?.[1]) continue;
		if (/[\s<>"|?*\0]/.test(m[1])) return null;
		const line = Number(m[2]) || undefined;
		const end = ranged ? Number(m[3]) || undefined : undefined;
		return {
			path: m[1].replaceAll("\\", "/"),
			...(line ? { line } : {}),
			...(line && end && end >= line ? { end } : {}),
		};
	}
	return null;
}

/** `#42`, `incident #42` or `incident 42`. */
export function incidentNumber(text: string): number | null {
	const m = /^(?:incident\s*)?#?(\d{1,9})$/i.exec(text.trim());
	return m?.[1] ? Number(m[1]) : null;
}

async function within(root: string, path: string): Promise<string | null> {
	const target = isAbsolute(path) ? resolve(path) : resolve(root, path);
	const rel = relative(resolve(root), target);
	if (!rel || rel.startsWith("..") || isAbsolute(rel)) return null;
	try {
		// A link or junction that leaves the workspace is never followed.
		const [real, realRoot] = await Promise.all([
			realpath(target),
			realpath(root),
		]);
		if (real !== realRoot && !real.startsWith(realRoot + sep)) return null;
		if (!(await stat(real)).isFile()) return null;
	} catch {
		return null;
	}
	return rel.split(sep).join("/");
}

@Injectable()
export class LinksService {
	constructor(
		private readonly prisma: PrismaService,
		@Optional() private readonly images?: ImagesService,
	) {}

	async resolve(
		id: string,
		candidates: LinkCandidate[],
	): Promise<(LinkTarget | null)[]> {
		const run = await this.prisma.investigation.findUnique({
			where: { id },
			select: { id: true, workspace: true },
		});
		if (!run) throw new ORPCError("NOT_FOUND", { message: "Thread not found" });
		const ws =
			RunWorkspaceSchema.safeParse(safeParseJsonObject(run.workspace)).data ??
			null;
		const artifacts = candidates.some((c) => c.kind === "artifact")
			? await this.artifacts(id)
			: [];
		let deleted: Set<string> | null = null;
		const out: (LinkTarget | null)[] = [];
		for (const c of candidates) {
			switch (c.kind) {
				case "path": {
					const ref = parsePathRef(c.text);
					let hit = ref ? await this.file(ws, ref) : null;
					if (!hit && ref) {
						deleted ??= await this.deletedPaths(ws);
						if (deleted.has(ref.path)) hit = { type: "diff", path: ref.path };
					}
					out.push(hit);
					break;
				}
				case "url":
					out.push(await this.url(id, c.text));
					break;
				case "thread":
					out.push(await this.thread(c.text));
					break;
				case "incident":
					out.push(await this.incident(c.text));
					break;
				case "artifact": {
					const a = artifacts.find(
						(x) => x.title.toLowerCase() === c.text.trim().toLowerCase(),
					);
					out.push(a ? { type: "artifact", id: a.id, title: a.title } : null);
					break;
				}
				default:
					// Sub-agents resolve once surface B records them.
					out.push(null);
			}
		}
		return out;
	}

	/** The first workspace repo that holds the path; the cwd's repo is tried first. */
	private async file(
		ws: RunWorkspace | null,
		ref: PathRef,
	): Promise<LinkTarget | null> {
		if (!ws) return null;
		const repos = [...ws.repos].sort(
			(a, b) =>
				Number(ws.cwd.startsWith(b.dir)) - Number(ws.cwd.startsWith(a.dir)),
		);
		if (!repos.length) {
			// A folder run records no repos: its cwd is the live folder, so the target has no commit.
			const rel = await within(ws.cwd, ref.path);
			return rel
				? {
						type: "file",
						repo: basename(ws.cwd),
						sha: "",
						path: rel,
						...(ref.line ? { line: ref.line } : {}),
						...(ref.end ? { end: ref.end } : {}),
					}
				: null;
		}
		for (const repo of repos) {
			const roots = [repo.dir];
			if (ws.cwd !== repo.dir && ws.cwd.startsWith(repo.dir))
				roots.unshift(ws.cwd);
			for (const root of roots) {
				const rel = await within(root, ref.path);
				if (!rel) continue;
				const fromRepo = relative(repo.dir, resolve(root, rel))
					.split(sep)
					.join("/");
				return {
					type: "file",
					repo: repo.name,
					sha: repo.head,
					path: fromRepo,
					...(ref.line ? { line: ref.line } : {}),
					...(ref.end ? { end: ref.end } : {}),
				};
			}
		}
		return null;
	}

	private async deletedPaths(ws: RunWorkspace | null): Promise<Set<string>> {
		const changes = await readWorktreeChanges(ws, { deadlineMs: 5_000 }).catch(
			() => null,
		);
		const out = new Set<string>();
		for (const r of changes?.repos ?? [])
			if (r.state === "ok")
				for (const f of r.files) if (f.status === "deleted") out.add(f.path);
		return out;
	}

	private async url(id: string, text: string): Promise<LinkTarget | null> {
		let href: string;
		try {
			const u = new URL(text.trim());
			if (u.protocol !== "https:" && u.protocol !== "http:") return null;
			href = u.href;
		} catch {
			return null;
		}
		const pr = await this.prisma.pullRequest.findFirst({
			where: { investigationId: id, url: href.replace(/\/$/, "") },
		});
		return pr
			? {
					type: "pull_request",
					pullRequest: pullRequestView(pr, imageFor(this.images)),
				}
			: { type: "url", href };
	}

	private async thread(text: string): Promise<LinkTarget | null> {
		const id = text.trim().replace(/^thread\s+/i, "");
		if (!UUID.test(id)) return null;
		const t = await this.prisma.investigation.findUnique({
			where: { id },
			select: { id: true, title: true, status: true },
		});
		return t
			? {
					type: "thread",
					id: t.id,
					number: null,
					title: t.title,
					state: t.status,
				}
			: null;
	}

	private async incident(text: string): Promise<LinkTarget | null> {
		const number = incidentNumber(text);
		if (number === null) return null;
		const i = await this.prisma.incident.findUnique({
			where: { number },
			select: { id: true, number: true },
		});
		return i ? { type: "incident", id: i.id, number: i.number } : null;
	}

	/** Pages this run published, newest title winning. */
	private async artifacts(
		id: string,
	): Promise<{ id: string; title: string }[]> {
		const rows = await this.prisma.investigationEvent.findMany({
			where: {
				investigationId: id,
				event: { contains: '"artifact_published"' },
			},
			orderBy: { seq: "desc" },
			select: { event: true },
		});
		const out: { id: string; title: string }[] = [];
		for (const r of rows) {
			let raw: unknown;
			try {
				raw = JSON.parse(r.event);
			} catch {
				continue;
			}
			const e = CanonicalEventSchema.safeParse(raw).data;
			if (e?.kind === "artifact_published")
				out.push({ id: e.artifact.id, title: e.artifact.title });
		}
		return out;
	}
}
