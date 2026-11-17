// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Sumit Patel

/**
 * A thread that fixes failing checks or review comments on one PR head (#1176 D1, D4, D7):
 * previewed with every word it sends and where it runs, then started exactly as previewed.
 */
import { Injectable } from "@nestjs/common";
import { ORPCError } from "@orpc/nest";
import {
	AccessLevelSchema,
	type FixPlace,
	type FixPreview,
	type FixPreviewItem,
	type FixRef,
	type FixRefusal,
	type FixThreadInput,
	type PrCheckRun,
	type PrReviewThread,
	type PullRequest,
	RunChoiceSchema,
	type StartFixThreadInput,
	type ThreadLink,
} from "@prismalens/contracts";
import { shownRepoUrl } from "../../core/harness/git-credential.js";
import { settingsFor } from "../../core/harness/run-worktree.js";
import { PrismaService } from "../../core/prisma/prisma.service.js";
import { threadLink } from "../thread-tree/tree-text.js";
import { checkRef, fetchHead, hasCommit, pushUrls } from "./fix-git.js";
import {
	checkIdent,
	fixActionId,
	fixDigest,
	fixEvidence,
	fixText,
	fixTitle,
	parseFixReason,
	type SeedItem,
	safeRef,
	safeRepo,
} from "./fix-seed.js";
import { parsePrUrl, remoteOf } from "./pr-url.js";
import { keyedQueue, PullRequestsService } from "./pull-requests.service.js";
import { readThreadContextSettings } from "./thread-context-settings.js";
import { ThreadsService, type TreePlacement } from "./threads.service.js";

/** An unadmitted fix thread this young is still starting, so it covers its items (OBJ-006). */
const STARTING_MS = 60_000;
const RELEASED = "action:fix-released:";

type Requested = {
	kind: "check" | "review";
	ident: string;
	label: string;
	seed: SeedItem;
	run?: PrCheckRun;
};

interface Computed {
	preview: FixPreview;
	/** Unadmitted, stale fix threads on this head that Start releases. */
	stale: string[];
	ref: FixRef | null;
	folder: string | null;
	repoUrl: string | null;
}

const refusal = (
	reason: FixRefusal,
	detail: string,
	title = "Fix",
): Computed => ({
	preview: {
		title,
		items: [],
		covered: [],
		text: null,
		evidence: null,
		digest: null,
		place: null,
		refusal: { reason, detail: detail.slice(0, 300) },
	},
	stale: [],
	ref: null,
	folder: null,
	repoUrl: null,
});

function nodeState(status: string): ThreadLink["state"] {
	switch (status) {
		case "pending":
			return "queued";
		case "completed":
			return "answered";
		case "failed":
			return "failed";
		case "cancelled":
			return "stopped";
		default:
			return "running";
	}
}

@Injectable()
export class FixThreadsService {
	private readonly queue = keyedQueue();

	constructor(
		private readonly prisma: PrismaService,
		private readonly pullRequests: PullRequestsService,
		private readonly threads: ThreadsService,
	) {}

	async preview(input: FixThreadInput): Promise<FixPreview> {
		return (await this.compute(input)).preview;
	}

	/** Start the previewed thread (D7): one Start per PR head at a time, and only as previewed. */
	async start(input: StartFixThreadInput) {
		const pr = await this.pullRequests.one(input.id, input.prId);
		if (!pr)
			throw new ORPCError("NOT_FOUND", { message: "Pull request not found" });
		return this.queue(`${input.prId}:${pr.headSha ?? ""}`, async () => {
			const { preview, stale, ref, folder, repoUrl } =
				await this.compute(input);
			if (preview.refusal)
				throw new ORPCError("BAD_REQUEST", {
					message: preview.refusal.detail,
				});
			const place = preview.place;
			if (
				!preview.items.length ||
				!place ||
				!ref ||
				preview.text === null ||
				preview.evidence === null ||
				preview.digest !== input.digest
			)
				throw new ORPCError("CONFLICT", {
					message: "It changed; review again",
				});
			for (const id of stale)
				await this.prisma.investigation.updateMany({
					where: { id, triggerReason: { startsWith: "action:fix:" } },
					data: { triggerReason: `${RELEASED}${id}` },
				});
			if (place.fetch && folder) {
				const got = await fetchHead(folder, place.headRef);
				if (!got.ok)
					throw new ORPCError("BAD_REQUEST", {
						message: "Couldn't fetch the branch",
						data: { detail: got.stderr },
					});
				if (!(await hasCommit(folder, place.headSha)))
					throw new ORPCError("CONFLICT", {
						message: "It changed; review again",
					});
			}
			const harness = RunChoiceSchema.shape.harness.safeParse(
				place.harness,
			).data;
			const placement: TreePlacement & { carry: string } = {
				parentId: input.id,
				rootId: null,
				role: "fork",
				depth: 0,
				title: preview.title,
				actionId: fixActionId(ref),
				carry: preview.evidence,
				at: (r) => (r.url === repoUrl ? place.headSha : undefined),
			};
			return this.threads.start(
				{
					subject: { kind: "project", repositoryId: place.projectId },
					text: preview.text,
					...(place.accessLevel ? { accessLevel: place.accessLevel } : {}),
					...(harness ? { harness } : {}),
					...(place.model ? { model: place.model } : {}),
					...(place.effort ? { effort: place.effort } : {}),
				},
				placement,
			);
		});
	}

	/** D4: each step in order; the first refusal wins. */
	private async compute(input: FixThreadInput): Promise<Computed> {
		if (!(await readThreadContextSettings(this.prisma)).prStatus)
			return refusal("status-off", "Pull request status is off in Settings.");
		const source = await this.prisma.investigation.findUnique({
			where: { id: input.id },
			select: {
				repositoryId: true,
				harness: true,
				model: true,
				effort: true,
				accessLevel: true,
			},
		});
		if (!source)
			throw new ORPCError("NOT_FOUND", { message: "Thread not found" });
		let pr = await this.pullRequests.one(input.id, input.prId);
		if (!pr)
			throw new ORPCError("NOT_FOUND", { message: "Pull request not found" });
		if (pr.state !== "open" && pr.state !== "draft")
			return refusal("closed", "It isn't open.");
		if (!pr.headSha || !pr.headRef)
			return refusal("no-head", "The host hasn't said which commit it's at.");
		if (!pr.headRepo) {
			pr = (await this.pullRequests.refreshOne(input.id, input.prId)) ?? pr;
			if (!pr.headRepo)
				return refusal(
					"fork-branch",
					"Can't tell which repository the branch is in.",
				);
		}
		if (pr.headRepo.toLowerCase() !== pr.repo.toLowerCase())
			return refusal("fork-branch", "Its branch is in another repository.");
		const headSha = pr.headSha;
		const headRef = pr.headRef;
		if (!headSha || !headRef)
			return refusal("no-head", "The host hasn't said which commit it's at.");

		const parsed = parsePrUrl(pr.url);
		const matching = parsed
			? (await this.pullRequests.remotes()).filter(
					(r) => r.host === parsed.host && r.repo === parsed.repo.toLowerCase(),
				)
			: [];
		const remote =
			matching.find((r) => r.repositoryId === source.repositoryId) ??
			matching[0];
		if (!remote)
			return refusal("no-project", "No project has this repository.");
		const project = await this.prisma.repository.findUnique({
			where: { id: remote.repositoryId },
			select: {
				id: true,
				fullName: true,
				sourceKind: true,
				plain: true,
				url: true,
			},
		});
		if (!project)
			return refusal("no-project", "No project has this repository.");
		if (project.plain)
			return refusal("plain-folder", "The project is a folder without git.");
		if (!safeRepo(remote.repo))
			return refusal("no-project", "The repository's name can't be used.");

		const items = this.requested(pr, input);
		if ("reason" in items) return refusal(items.reason, items.detail);

		const folder = project.sourceKind === "folder" ? project.url : null;
		let fetch = false;
		const okRef = safeRef(headRef) && (await checkRef(headRef));
		if (folder && !(await hasCommit(folder, headSha))) {
			if (!okRef)
				return refusal(
					"missing-commit",
					"The project's folder doesn't have the head commit.",
				);
			fetch = true;
		}

		const method =
			project.sourceKind === "folder" ? settingsFor(null).method : "clone";
		let push: FixPlace["push"] = "none";
		let pushUrl: string | null = null;
		let pushNote: FixPlace["pushNote"] = null;
		if (!okRef) pushNote = "unsafe-ref";
		else if (method === "clone" || !folder) pushNote = "clone";
		else {
			const urls = await pushUrls(folder);
			const at = urls.length === 1 && urls[0] ? remoteOf("", urls[0]) : null;
			if (at && at.host === remote.host && at.repo === remote.repo) {
				push = "branch";
				pushUrl = shownRepoUrl("url", urls[0] as string);
			} else pushNote = "push-elsewhere";
		}

		const own = (await this.pullRequests.ownPrIds(input.id, [pr])).includes(
			pr.id,
		);
		const place: FixPlace = {
			projectId: project.id,
			projectName: project.fullName.slice(0, 200),
			source: project.sourceKind === "folder" ? "folder" : "url",
			headRef: headRef.slice(0, 300),
			headSha,
			fetch,
			push,
			pushUrl,
			pushNote,
			own,
			harness: source.harness,
			model: source.model,
			effort: source.effort,
			accessLevel: AccessLevelSchema.safeParse(source.accessLevel).data ?? null,
		};

		for (const it of items)
			if (it.kind === "check" && it.run?.id && it.seed.kind === "check") {
				const log = await this.pullRequests.checkLog(
					input.id,
					input.prId,
					it.run.id,
				);
				it.seed.step = log.step;
				it.seed.lines = log.lines;
				it.seed.unavailable = log.unavailable;
			}

		const { covered, stale } = await this.coverage(
			input.id,
			pr.id,
			headSha,
			items,
		);
		const open = items.filter((i) => !covered.some((c) => c.ident === i.ident));
		const shownItems: FixPreviewItem[] = open.map((i) => ({
			kind: i.kind,
			ident: i.ident,
			label: i.label,
		}));
		const seedInput = {
			host: pr.host,
			number: pr.number,
			repo: remote.repo,
			headRef,
			headSha,
			push,
			items: (open.length ? open : items).map((i) => i.seed),
		};
		const title = fixTitle(seedInput);
		if (!open.length)
			return {
				preview: {
					title,
					items: [],
					covered,
					text: null,
					evidence: null,
					digest: null,
					place,
					refusal: null,
				},
				stale,
				ref: null,
				folder,
				repoUrl: project.url,
			};
		const text = fixText(seedInput);
		const evidence = fixEvidence(seedInput);
		return {
			preview: {
				title,
				items: shownItems,
				covered,
				text,
				evidence,
				digest: fixDigest({ text, evidence, title, items: shownItems, place }),
				place,
				refusal: null,
			},
			stale,
			ref: {
				prId: pr.id,
				headSha,
				items: open.map((i) => ({ kind: i.kind, ident: i.ident })),
			},
			folder,
			repoUrl: project.url,
		};
	}

	/** Each asked item on the stored PR, or the first refusal (D4.6). */
	private requested(
		pr: PullRequest,
		input: FixThreadInput,
	): Requested[] | { reason: FixRefusal; detail: string } {
		const out: Requested[] = [];
		for (const item of input.items) {
			if (item.kind === "check") {
				const run = pr.checkRuns?.find((r) => r.id === item.runId);
				if (run?.state !== "failing")
					return { reason: "not-failing", detail: "It isn't failing now." };
				if (run.cancelled)
					return { reason: "cancelled", detail: "It was cancelled." };
				out.push({
					kind: "check",
					ident: checkIdent(run),
					label: `${run.name}${run.appName ? ` · ${run.appName}` : ""}`.slice(
						0,
						200,
					),
					run,
					seed: {
						kind: "check",
						name: run.name,
						...(run.appName ? { appName: run.appName } : {}),
						...(run.url ? { url: run.url } : {}),
						step: null,
						lines: [],
						unavailable: null,
					},
				});
			} else {
				const t: PrReviewThread | undefined = pr.reviewThreads?.find(
					(r) => r.id === item.reviewThreadId,
				);
				if (!t || t.resolved)
					return { reason: "resolved", detail: "It's resolved." };
				out.push({
					kind: "review",
					ident: t.id.slice(0, 300),
					label:
						`${t.path.split("/").at(-1) ?? t.path}${t.line ? `:${t.line}` : ""}`.slice(
							0,
							200,
						),
					seed: {
						kind: "review",
						id: t.id,
						path: t.path,
						line: t.line,
						outdated: t.outdated,
						author: t.author,
						...(t.url ? { url: t.url } : {}),
						excerpt: t.excerpt,
						...(t.last
							? { last: { author: t.last.author, excerpt: t.last.excerpt } }
							: {}),
					},
				});
			}
		}
		const seen = new Set<string>();
		return out.filter((i) => !seen.has(i.ident) && !!seen.add(i.ident));
	}

	/**
	 * D4.11: an item is covered by the newest admitted fix thread on this head that holds its
	 * ident; an unadmitted one counts only while it is young and not failed.
	 */
	private async coverage(
		threadId: string,
		prId: string,
		headSha: string,
		items: Requested[],
	): Promise<{ covered: FixPreview["covered"]; stale: string[] }> {
		const children = await this.prisma.investigation.findMany({
			where: {
				parentId: threadId,
				triggerReason: { startsWith: "action:fix:" },
			},
			orderBy: { createdAt: "desc" },
			select: {
				id: true,
				title: true,
				status: true,
				harness: true,
				triggerReason: true,
				createdAt: true,
				completedAt: true,
				incidentId: true,
				scheduleId: true,
			},
		});
		const covered: FixPreview["covered"] = [];
		const stale: string[] = [];
		for (const c of children) {
			const ref = parseFixReason(c.triggerReason);
			if (!ref || ref.prId !== prId || ref.headSha !== headSha) continue;
			const admitted = !!(await this.prisma.job.findUnique({
				where: { investigationId: c.id },
				select: { id: true },
			}));
			if (!admitted) {
				const young =
					Date.now() - c.createdAt.getTime() < STARTING_MS &&
					c.status !== "failed";
				if (!young) {
					stale.push(c.id);
					continue;
				}
			}
			const link: ThreadLink = {
				id: c.id,
				title: c.title,
				link: threadLink(c),
				state: nodeState(c.status),
				harness: c.harness,
				startedAt: c.createdAt.toISOString(),
				unread: 0,
				via: "fix",
				fix: ref,
				endedAt: c.completedAt?.toISOString() ?? null,
			};
			for (const i of items)
				if (
					!covered.some((x) => x.ident === i.ident) &&
					ref.items.some((r) => r.kind === i.kind && r.ident === i.ident)
				)
					covered.push({ ident: i.ident, label: i.label, link });
		}
		return { covered, stale };
	}
}
