// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Sumit Patel

/**
 * A thread's pull requests (#1024, surface D): found in the agent's text, on the
 * workspace branch, or pasted; stored once per thread, and read from the git host
 * only while someone looks, with the credential the repository clones with.
 */
import { tmpdir } from "node:os";
import {
	Inject,
	Injectable,
	Logger,
	type OnModuleInit,
	Optional,
} from "@nestjs/common";
import { ORPCError } from "@orpc/nest";
import type {
	CanonicalEvent,
	PrCheckLog,
	PrCheckRun,
	PrChecks,
	PrDetail,
	PrSource,
	PullRequest,
	RunWorkspace,
	ThreadPullRequests,
	ThreadRowPr,
	WorkItem,
} from "@prismalens/contracts";
import {
	AgentPlanSchema,
	NO_CHECKS,
	PR_CHECK_LOGS_MAX,
	PrChecksSchema,
	PrDetailSchema,
	PrHostSchema,
	PrReviewSchema,
	PrSourceSchema,
	PrStateSchema,
	prHostTerms,
	prTone,
	RunWorkspaceSchema,
} from "@prismalens/contracts";
import type { PullRequest as PullRequestRow } from "@prismalens/database";
import type { AuthenticatedRequestFn } from "@prismalens/integrations";
import { gitEnv } from "../../core/harness/git-env.js";
import {
	GIT_PROBE_TIMEOUT_MS,
	spawnGit,
} from "../../core/harness/git-spawn.js";
import { PrismaService } from "../../core/prisma/prisma.service.js";
import { safeParseJsonObject } from "../../shared/utils/json-utils.js";
import { ImagesService } from "../images/images.service.js";
import {
	GitCredentialService,
	type GitRepoRef,
} from "../integrations/git-credential.service.js";
import { sourceRequestFn } from "../integrations/source-request.js";
import { InvestigationsService } from "../investigations/investigations.service.js";
import { codeHost } from "./code-hosts/registry.js";
import {
	type CheckLogRead,
	type EtagCache,
	type HostRead,
	HostReadError,
	LOG_UNAVAILABLE,
	type PrActivityItem,
} from "./pr-hosts.js";
import {
	apiBase,
	type KnownRemote,
	type PrUrl,
	parsePrUrl,
	prUrlsIn,
	remoteOf,
	trustedRemote,
} from "./pr-url.js";
import { readThreadContextSettings } from "./thread-context-settings.js";
import { byNumber, search, workApiBase, workHostOf } from "./work-items.js";

/** The fetch PR reads use; tests hand in recorded host answers. */
export const PR_FETCH = Symbol("PR_FETCH");

export const PR_CACHE_MS = 60_000;
export const PR_TIMEOUT_MS = 10_000;
export const PR_MAX_BYTES = 1024 * 1024;
/** Branch event branchId for what PrismaLens itself records beside the agent's stream. */
export const LINKS_BRANCH = "__links__";

/** A configured repository's git remote, or a folder project's `origin`. */
interface Remote extends KnownRemote {
	ref: GitRepoRef;
}

/** A stored host image URL to what a read serves; undefined drops it. */
export type ImageFor = (url: string) => string | undefined;

/** The proxy's signed path for a host's avatar; GitLab and Bitbucket hand these out from their APIs. */
export function imageFor(images: ImagesService | undefined): ImageFor {
	return images
		? (url) => images.urlFor(url, "avatar", { fromHostApi: true })
		: noImages;
}

/** Without the proxy, no host image is served at all: never the raw URL (#1024). */
const noImages: ImageFor = () => undefined;

function detailView(raw: unknown, image: ImageFor): PrDetail | undefined {
	const detail = PrDetailSchema.safeParse(raw).data;
	if (!detail) return undefined;
	const person = <T extends { avatarUrl?: string }>(p: T): T => {
		const { avatarUrl, ...rest } = p;
		const shown = avatarUrl ? image(avatarUrl) : undefined;
		return (shown ? { ...rest, avatarUrl: shown } : rest) as T;
	};
	const { author, reviewers, checkRuns, ...rest } = detail;
	return {
		...rest,
		...(author ? { author: person(author) } : {}),
		...(reviewers ? { reviewers: reviewers.map(person) } : {}),
		...(checkRuns
			? {
					checkRuns: checkRuns.map(({ appAvatarUrl, ...run }) => {
						const shown = appAvatarUrl ? image(appAvatarUrl) : undefined;
						return shown ? { ...run, appAvatarUrl: shown } : run;
					}),
				}
			: {}),
	};
}

/**
 * The host itself could not answer: no connection, a 5xx or a 429. Any other answer,
 * a deleted PR's 404 included, is about that PR, so a watch need not back off for it.
 */
export function hostDown(e: unknown): boolean {
	if (!(e instanceof HostReadError)) return true;
	return e.status !== undefined && (e.status >= 500 || e.status === 429);
}

export function pullRequestView(
	row: PullRequestRow,
	image: ImageFor = noImages,
): PullRequest {
	const checks: PrChecks =
		PrChecksSchema.safeParse(safeParseJsonObject(row.checks)).data ?? NO_CHECKS;
	const fields = {
		state: PrStateSchema.safeParse(row.state).data ?? "unknown",
		review: PrReviewSchema.safeParse(row.review).data ?? "unknown",
		checks,
		conflicts: row.conflicts,
	};
	return {
		id: row.id,
		url: row.url,
		host: PrHostSchema.safeParse(row.host).data ?? "other",
		repo: row.repo,
		number: row.number,
		title: row.title,
		...fields,
		tone: prTone(fields),
		source: PrSourceSchema.safeParse(row.source).data ?? "agent",
		fetchedAt: row.fetchedAt?.toISOString() ?? null,
		headSha: row.headSha ?? null,
		...detailView(safeParseJsonObject(row.detail), image),
	};
}

/** One shared read of a PR (#1024 surface F): its state for every thread that links it, and its activity. */
export interface SharedRead {
	read: HostRead;
	activity: PrActivityItem[];
}

@Injectable()
export class PullRequestsService implements OnModuleInit {
	private readonly logger = new Logger(PullRequestsService.name);
	private remotesCache: { at: number; value: Promise<Remote[]> } | null = null;
	/** When each thread's branch was last looked up on the host. */
	private readonly branchLookedUp = new Map<string, number>();

	constructor(
		private readonly prisma: PrismaService,
		private readonly credentials: GitCredentialService,
		private readonly investigations: InvestigationsService,
		@Optional() @Inject(PR_FETCH) private readonly fetchImpl?: typeof fetch,
		@Optional() private readonly images?: ImagesService,
	) {}

	/** A row as a read shows it, its avatars through the image proxy (#1024). */
	private view(row: PullRequestRow): PullRequest {
		return pullRequestView(row, imageFor(this.images));
	}

	onModuleInit(): void {
		this.investigations.onEventsAppended((id, events) =>
			this.readAgentEvents(id, events),
		);
	}

	/** The agent's text names PRs, and its plan replaces the stored one; neither calls a host. */
	async readAgentEvents(
		investigationId: string,
		events: CanonicalEvent[],
	): Promise<void> {
		const texts: string[] = [];
		let plan: unknown = null;
		for (const e of events) {
			if (e.kind === "agent_step") texts.push(e.text);
			else if (e.kind === "tool_result") texts.push(e.result.preview);
			else if (e.kind === "plan") plan = e.entries;
		}
		if (plan) {
			const parsed = AgentPlanSchema.safeParse(plan);
			if (parsed.success)
				await this.prisma.investigation.updateMany({
					where: { id: investigationId },
					data: { agentPlan: JSON.stringify(parsed.data) },
				});
		}
		const urls = prUrlsIn(texts.join("\n"));
		if (!urls.length) return;
		const remotes = await this.remotes();
		for (const pr of urls) {
			const remote = trustedRemote(pr, remotes);
			if (remote) await this.store(investigationId, pr, remote, "agent");
		}
	}

	/** A URL the user pasted: refused unless it is a PR on a configured repository. */
	async linkFromUser(
		investigationId: string,
		url: string,
		/** `agent` when its `pl_pr_link` tool asked (#1024 spec B). */
		source: "user" | "agent" = "user",
	): Promise<PullRequest> {
		await this.requireThread(investigationId);
		const pr = parsePrUrl(url);
		if (!pr)
			throw new ORPCError("BAD_REQUEST", {
				message: "That is not a pull request or merge request URL.",
			});
		const remote = trustedRemote(pr, await this.remotes());
		if (!remote)
			throw new ORPCError("BAD_REQUEST", {
				message: `That ${prHostTerms(pr.shape).changeRequest} is not on a repository PrismaLens knows. Add the repository first.`,
			});
		const row = await this.store(investigationId, pr, remote, source);
		// The link is stored either way; only "Show pull request status" lets it reach the host.
		if (!(await readThreadContextSettings(this.prisma)).prStatus)
			return this.view(row);
		const [fresh] = await this.refreshRows([row], true);
		return this.view(fresh ?? row);
	}

	async unlink(investigationId: string, prId: string): Promise<boolean> {
		const { count } = await this.prisma.pullRequest.deleteMany({
			where: { id: prId, investigationId },
		});
		return count > 0;
	}

	/**
	 * The thread's PRs, each read from its host when older than 60 s, and its branch
	 * looked up when it has one; `force` skips the 60 s cache (ETags still apply).
	 */
	async list(
		investigationId: string,
		opts: { force?: boolean } = {},
	): Promise<ThreadPullRequests> {
		const run = await this.requireThread(investigationId);
		const { prStatus } = await readThreadContextSettings(this.prisma);
		if (prStatus) await this.lookUpBranch(run, opts.force ?? false);
		let rows = await this.rows(investigationId);
		if (prStatus) rows = await this.refreshRows(rows, opts.force ?? false);
		return {
			pullRequests: rows.map((r) => this.view(r)),
			statusEnabled: prStatus,
		};
	}

	/** Stored state only, never a host call: what a list row or a context read shows. */
	async stored(investigationId: string): Promise<PullRequest[]> {
		return (await this.rows(investigationId)).map((r) => this.view(r));
	}

	/** Each thread's newest PR as number and tone, for feed rows. */
	async rowGlyphs(ids: string[]): Promise<Map<string, ThreadRowPr>> {
		const out = new Map<string, ThreadRowPr>();
		if (!ids.length) return out;
		const rows = await this.prisma.pullRequest.findMany({
			where: { investigationId: { in: ids } },
			orderBy: { createdAt: "desc" },
		});
		const counts = new Map<string, number>();
		for (const r of rows)
			counts.set(r.investigationId, (counts.get(r.investigationId) ?? 0) + 1);
		for (const r of rows)
			if (!out.has(r.investigationId)) {
				const v = pullRequestView(r);
				out.set(r.investigationId, {
					number: v.number,
					tone: v.tone,
					count: counts.get(r.investigationId) ?? 1,
					title: v.title,
					checks: v.checks,
				});
			}
		return out;
	}

	private rows(investigationId: string): Promise<PullRequestRow[]> {
		return this.prisma.pullRequest.findMany({
			where: { investigationId },
			orderBy: { createdAt: "asc" },
		});
	}

	private async requireThread(id: string) {
		const run = await this.prisma.investigation.findUnique({
			where: { id },
			select: { id: true, workspace: true, repositoryId: true },
		});
		if (!run) throw new ORPCError("NOT_FOUND", { message: "Thread not found" });
		return run;
	}

	/** Stores the PR once per thread; a first link also lands in the conversation. */
	private async store(
		investigationId: string,
		pr: PrUrl,
		remote: Remote,
		source: PrSource,
	): Promise<PullRequestRow> {
		const existing = await this.prisma.pullRequest.findUnique({
			where: { investigationId_url: { investigationId, url: pr.url } },
		});
		if (existing) return existing;
		const row = await this.prisma.pullRequest.create({
			data: {
				investigationId,
				repositoryId: remote.repositoryId,
				host: pr.shape,
				repo: pr.repo,
				url: pr.url,
				number: pr.number,
				source,
			},
		});
		const seq = (await this.investigations.lastEventSeq(investigationId)) + 1;
		await this.investigations.appendEvents(investigationId, [
			{
				kind: "pull_request_linked",
				runId: investigationId,
				branchId: LINKS_BRANCH,
				path: [],
				label: null,
				seq,
				ts: new Date().toISOString(),
				prId: row.id,
				url: row.url,
				source,
			},
		]);
		return row;
	}

	/**
	 * A PR watch's pass (#1024 spec B): every PR read from its host now, and whether any
	 * host failed to answer, so the watch can back off instead of asking again.
	 */
	async refreshForWatch(
		investigationId: string,
	): Promise<{ pullRequests: PullRequest[]; failed: boolean }> {
		const failures: string[] = [];
		const rows = await this.refreshRows(
			await this.rows(investigationId),
			true,
			failures,
		);
		return {
			pullRequests: rows.map((r) => this.view(r)),
			failed: failures.length > 0,
		};
	}

	/** Reads stale rows from their hosts; a host that fails leaves the row as it was. */
	private async refreshRows(
		rows: PullRequestRow[],
		force: boolean,
		/** Each row whose host did not answer, for a caller that backs off. */
		failures?: string[],
	): Promise<PullRequestRow[]> {
		const remotes = await this.remotes();
		const out: PullRequestRow[] = [];
		for (const row of rows) {
			const fresh =
				!force &&
				row.fetchedAt &&
				Date.now() - row.fetchedAt.getTime() < PR_CACHE_MS;
			const pr = parsePrUrl(row.url);
			const remote = pr ? trustedRemote(pr, remotes) : null;
			if (fresh || !pr || !remote || !apiBase(pr)) {
				out.push(row);
				continue;
			}
			const cache = (safeParseJsonObject(row.etag) ?? {}) as EtagCache;
			try {
				const read = await this.read(pr, remote, cache);
				const detail = await this.withExtras(pr, remote, row, read);
				out.push(
					await this.prisma.pullRequest.update({
						where: { id: row.id },
						data: {
							title: read.title,
							state: read.state,
							review: read.review,
							checks: JSON.stringify(read.checks),
							conflicts: read.conflicts,
							detail: JSON.stringify(detail),
							etag: JSON.stringify(cache),
							headSha: read.headSha,
							fetchedAt: new Date(),
						},
					}),
				);
			} catch (e) {
				this.logger.warn(
					`Could not read ${pr.host} ${pr.repo}#${pr.number}: ${e instanceof Error ? e.message : String(e)}`,
				);
				if (hostDown(e)) failures?.push(row.id);
				out.push(row);
			}
		}
		return out;
	}

	/**
	 * The PR status feed's one read per PR URL (#1024 surface F): state, checks and
	 * activity, written to every thread's row for that URL. Throws when the host fails.
	 */
	async readShared(
		url: string,
		activityCache: EtagCache,
	): Promise<SharedRead | null> {
		const rows = await this.prisma.pullRequest.findMany({ where: { url } });
		const first = rows[0];
		const pr = parsePrUrl(url);
		const remote = pr ? trustedRemote(pr, await this.remotes()) : null;
		const host = codeHost(pr?.shape);
		if (!first || !pr || !remote || !host) return null;
		const cache = (safeParseJsonObject(first.etag) ?? {}) as EtagCache;
		const read = await this.read(pr, remote, cache);
		const activity = await host.readActivity(
			await this.requestFn(host.apiBase(pr.host), remote),
			pr.repo,
			pr.number,
			activityCache,
		);
		const detail = await this.withExtras(pr, remote, first, read);
		await this.prisma.pullRequest.updateMany({
			where: { url },
			data: {
				title: read.title,
				state: read.state,
				review: read.review,
				checks: JSON.stringify(read.checks),
				conflicts: read.conflicts,
				detail: JSON.stringify(detail),
				etag: JSON.stringify(cache),
				headSha: read.headSha,
				fetchedAt: new Date(),
			},
		});
		return { read, activity };
	}

	/** The branches the thread works on, per configured repository, for automatic PR watches. */
	async threadBranches(
		threadId: string,
	): Promise<Array<{ repo: string; branch: string }>> {
		const run = await this.prisma.investigation.findUnique({
			where: { id: threadId },
			select: { workspace: true },
		});
		const ws =
			RunWorkspaceSchema.safeParse(safeParseJsonObject(run?.workspace ?? null))
				.data ?? null;
		const remotes = await this.remotes();
		const out: Array<{ repo: string; branch: string }> = [];
		for (const repo of ws?.repos ?? []) {
			if (!repo.branch) continue;
			const remote = await this.remoteForRepo(repo, remotes);
			if (remote) out.push({ repo: remote.repo, branch: repo.branch });
		}
		return out;
	}

	private async read(
		pr: PrUrl,
		remote: Remote,
		cache: EtagCache,
	): Promise<HostRead> {
		const host = codeHost(pr.shape);
		if (!host) throw new Error(`no API for ${pr.host}`);
		const req = await this.requestFn(host.apiBase(pr.host), remote);
		return host.read(req, pr.repo, pr.number, cache);
	}

	/**
	 * Bound to the fixed API origin: the credential never leaves it, no redirect is
	 * followed, an answer stops at 1 MB and a request at 10 s (source-request.ts).
	 */
	async requestFn(
		base: string,
		remote: Remote,
	): Promise<AuthenticatedRequestFn> {
		const authorization = await this.authorizationFor(remote);
		return sourceRequestFn(
			base,
			{
				ok: true,
				credential: authorization
					? { kind: "header", name: "Authorization", value: authorization }
					: { kind: "none" },
			},
			{
				maxRedirects: 0,
				maxBytes: PR_MAX_BYTES,
				timeoutMs: PR_TIMEOUT_MS,
				...(this.fetchImpl ? { fetchImpl: this.fetchImpl } : {}),
			},
		);
	}

	private async authorizationFor(remote: Remote): Promise<string | undefined> {
		try {
			const cred = await this.credentials.resolveForUse(remote.ref);
			return cred.authorization(cred.effectiveUrl ?? remote.gitUrl, "bearer");
		} catch (e) {
			// The machine-git and public tiers read a public repository without a header.
			this.logger.debug?.(
				`No token for ${remote.host}: ${e instanceof Error ? e.message : String(e)}`,
			);
			return undefined;
		}
	}

	/**
	 * A read's detail plus what it does not carry (#1101 category 15): review threads,
	 * read beside it, and log tails kept while the head commit stays the same.
	 */
	private async withExtras(
		pr: PrUrl,
		remote: Remote,
		row: PullRequestRow,
		read: HostRead,
	): Promise<PrDetail> {
		const prev = PrDetailSchema.safeParse(safeParseJsonObject(row.detail)).data;
		const logs = (prev?.checkLogs ?? []).filter(
			(l) => l.headSha === read.headSha,
		);
		const base = apiBase(pr) as string;
		let threads = prev?.reviewThreads;
		let note: string | undefined;
		try {
			threads = await codeHost(pr.shape)?.readReviewThreads(
				await this.requestFn(base, remote),
				pr.repo,
				pr.number,
				base,
			);
		} catch (e) {
			note =
				e instanceof HostReadError && (e.status === 401 || e.status === 403)
					? "Review threads need a token for this repository: the host shows them only to a signed-in reader."
					: "The host did not answer for review threads; they show as last read.";
		}
		return {
			...read.detail,
			...(threads ? { reviewThreads: threads } : {}),
			...(note ? { reviewThreadsNote: note } : {}),
			...(logs.length ? { checkLogs: logs } : {}),
		};
	}

	/**
	 * One check's log tail (#1101 category 15): kept per head commit once read, so the
	 * panel and the fix message never wait on the host twice. A host failure is not kept.
	 */
	async checkLog(
		investigationId: string,
		prId: string,
		runId: string,
	): Promise<PrCheckLog> {
		const row = await this.prisma.pullRequest.findFirst({
			where: { id: prId, investigationId },
		});
		if (!row)
			throw new ORPCError("NOT_FOUND", { message: "Pull request not found" });
		const detail =
			PrDetailSchema.safeParse(safeParseJsonObject(row.detail)).data ?? {};
		const run = detail.checkRuns?.find((r) => r.id === runId);
		const terms = prHostTerms(PrHostSchema.safeParse(row.host).data);
		if (!run)
			throw new ORPCError("NOT_FOUND", {
				message: `That ${terms.check} is not on this ${terms.changeRequest}.`,
			});
		const headSha = run.headSha ?? row.headSha ?? null;
		const kept = detail.checkLogs?.find(
			(l) => l.runId === runId && l.headSha === headSha,
		);
		if (kept) return kept;
		const read = await this.readLog(row, run);
		const log: PrCheckLog = {
			runId,
			headSha,
			...read,
			fetchedAt: new Date().toISOString(),
		};
		if (read.unavailable !== LOG_UNAVAILABLE.host)
			await this.prisma.pullRequest.update({
				where: { id: row.id },
				data: {
					detail: JSON.stringify({
						...detail,
						checkLogs: [
							log,
							...(detail.checkLogs ?? []).filter((l) => l.runId !== runId),
						].slice(0, PR_CHECK_LOGS_MAX),
					}),
				},
			});
		return log;
	}

	private async readLog(
		row: PullRequestRow,
		run: PrCheckRun,
	): Promise<CheckLogRead> {
		const none = (unavailable: string): CheckLogRead => ({
			step: null,
			lines: [],
			unavailable,
		});
		if (!(await readThreadContextSettings(this.prisma)).prStatus)
			return none(
				"Pull request status is off in Settings, so PrismaLens reads no logs.",
			);
		const pr = parsePrUrl(row.url);
		const remote = pr ? trustedRemote(pr, await this.remotes()) : null;
		const host = codeHost(pr?.shape);
		if (!pr || !remote || !host)
			return none(
				`This ${prHostTerms(pr?.shape).changeRequest}'s repository is not one PrismaLens reads from.`,
			);
		const base = host.apiBase(pr.host);
		try {
			const req = await this.requestFn(base, remote);
			const authorization = await this.authorizationFor(remote);
			const doFetch = this.fetchImpl ?? fetch;
			return await host.readCheckLog(
				{
					req,
					apiBase: base,
					locate: async (path) => {
						const res = await doFetch(new URL(path, `${base}/`).href, {
							headers: {
								Accept: "application/json",
								...(authorization ? { Authorization: authorization } : {}),
							},
							redirect: "manual",
							signal: AbortSignal.timeout(PR_TIMEOUT_MS),
						});
						await res.body?.cancel();
						return {
							status: res.status,
							location: res.headers.get("location"),
						};
					},
					// The signed log address carries its own access: no credential goes with it.
					download: (url) => {
						if (!url.startsWith("https://"))
							return Promise.resolve(new Response(null, { status: 404 }));
						return doFetch(url, { signal: AbortSignal.timeout(PR_TIMEOUT_MS) });
					},
				},
				pr.repo,
				run,
			);
		} catch (e) {
			this.logger.warn(
				`Could not read a check log on ${row.url}: ${e instanceof Error ? e.message : String(e)}`,
			);
			return none(
				hostDown(e) ? LOG_UNAVAILABLE.host : LOG_UNAVAILABLE.noAccess,
			);
		}
	}

	/** A named branch on a remote a code-host adapter reads: its open or latest PR, once a minute at most. */
	private async lookUpBranch(
		run: { id: string; workspace: string | null },
		force: boolean,
	): Promise<void> {
		const last = this.branchLookedUp.get(run.id);
		if (!force && last && Date.now() - last < PR_CACHE_MS) return;
		this.branchLookedUp.set(run.id, Date.now());
		const ws: RunWorkspace | null =
			RunWorkspaceSchema.safeParse(safeParseJsonObject(run.workspace)).data ??
			null;
		const remotes = await this.remotes();
		for (const repo of ws?.repos ?? []) {
			if (!repo.branch) continue;
			const remote = await this.remoteForRepo(repo, remotes);
			if (!remote) continue;
			const host = codeHost(workHostOf(remote.host));
			if (!host) continue;
			try {
				const req = await this.requestFn(host.apiBase(remote.host), remote);
				const found = await host.findByBranch(req, remote.repo, repo.branch);
				if (found) {
					const pr = parsePrUrl(found);
					if (pr && trustedRemote(pr, remotes))
						await this.store(run.id, pr, remote, "branch");
				}
			} catch (e) {
				this.logger.warn(
					`Could not look up ${repo.branch} on ${remote.host}: ${e instanceof Error ? e.message : String(e)}`,
				);
			}
		}
	}

	private async remoteForRepo(
		repo: RunWorkspace["repos"][number],
		remotes: Remote[],
	): Promise<Remote | null> {
		const url =
			repo.sourceKind === "folder" ? await originOf(repo.dir) : repo.url;
		if (!url) return null;
		const r = remoteOf("", url);
		return r
			? (remotes.find((k) => k.host === r.host && k.repo === r.repo) ?? null)
			: null;
	}

	/**
	 * Issues and PRs by number on a configured repository, for the `#` menu; none
	 * while "Show pull request status" is off or the host is one PrismaLens cannot read.
	 */
	async findWorkItems(repositoryId: string, n: number): Promise<WorkItem[]> {
		const at = await this.workTarget(repositoryId);
		return at ? byNumber(at.req, at.kind, at.remote.repo, n) : [];
	}

	/** Title matches on a configured repository, at most 20. */
	async searchWorkItems(repositoryId: string, q: string): Promise<WorkItem[]> {
		const at = await this.workTarget(repositoryId);
		return at ? search(at.req, at.kind, at.remote.repo, q) : [];
	}

	private async workTarget(repositoryId: string) {
		if (!(await readThreadContextSettings(this.prisma)).prStatus) return null;
		const remote = (await this.remotes()).find(
			(r) => r.repositoryId === repositoryId,
		);
		const kind = remote ? workHostOf(remote.host) : null;
		if (!remote || !kind) return null;
		const req = await this.requestFn(workApiBase(remote.host, kind), remote);
		return { remote, kind, req };
	}

	/** Every configured repository's remote, a folder's from its `origin`; cached 60 s. */
	remotes(): Promise<Remote[]> {
		const hit = this.remotesCache;
		if (hit && Date.now() - hit.at < PR_CACHE_MS) return hit.value;
		const value = this.loadRemotes();
		this.remotesCache = { at: Date.now(), value };
		value.catch(() => {
			this.remotesCache = null;
		});
		return value;
	}

	/** Drop the remotes cache, after a repository is added or removed. */
	forgetRemotes(): void {
		this.remotesCache = null;
	}

	private async loadRemotes(): Promise<Remote[]> {
		const repos = await this.prisma.repository.findMany({
			select: {
				id: true,
				sourceKind: true,
				url: true,
				connectionId: true,
				metadata: true,
			},
		});
		const out: Remote[] = [];
		for (const r of repos) {
			const url = r.sourceKind === "folder" ? await originOf(r.url) : r.url;
			if (!url) continue;
			const known = remoteOf(r.id, url);
			if (!known) continue;
			const meta = safeParseJsonObject(r.metadata) as {
				credentialConnectionId?: unknown;
			} | null;
			const pinned = meta?.credentialConnectionId;
			out.push({
				...known,
				ref:
					r.sourceKind === "folder"
						? { sourceKind: "url", url, connectionId: null, pick: null }
						: {
								sourceKind: "url",
								url,
								connectionId: r.connectionId,
								pick: typeof pinned === "string" ? pinned : null,
							},
			});
		}
		return out;
	}
}

/** A folder's `origin` URL, or null when it has none. */
async function originOf(dir: string): Promise<string | null> {
	try {
		const { stdout } = await spawnGit(
			["-C", dir, "remote", "get-url", "origin"],
			{
				cwd: tmpdir(),
				env: gitEnv({ source: "machine", coreSshCommand: null }),
				timeoutMs: GIT_PROBE_TIMEOUT_MS,
			},
		);
		return stdout.trim() || null;
	} catch {
		return null;
	}
}
