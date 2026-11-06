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
	PrChecksSchema,
	PrDetailSchema,
	PrHostSchema,
	PrReviewSchema,
	PrSourceSchema,
	PrStateSchema,
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
import {
	type EtagCache,
	type HostRead,
	readGithub,
	readGitlab,
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
	return {
		...(detail.author ? { author: person(detail.author) } : {}),
		...(detail.reviewers ? { reviewers: detail.reviewers.map(person) } : {}),
		...(detail.checkRuns
			? {
					checkRuns: detail.checkRuns.map(({ appAvatarUrl, ...run }) => {
						const shown = appAvatarUrl ? image(appAvatarUrl) : undefined;
						return shown ? { ...run, appAvatarUrl: shown } : run;
					}),
				}
			: {}),
	};
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
		...detailView(safeParseJsonObject(row.detail), image),
	};
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
		/** `agent` when its `pr_link` tool asked (#1024 spec B). */
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
				message:
					"That pull request is not on a repository PrismaLens knows. Add the repository first.",
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
		for (const r of rows)
			if (!out.has(r.investigationId)) {
				const v = pullRequestView(r);
				out.set(r.investigationId, { number: v.number, tone: v.tone });
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

	/** Reads stale rows from their hosts; a host that fails leaves the row as it was. */
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
				out.push(
					await this.prisma.pullRequest.update({
						where: { id: row.id },
						data: {
							title: read.title,
							state: read.state,
							review: read.review,
							checks: JSON.stringify(read.checks),
							conflicts: read.conflicts,
							detail: JSON.stringify(read.detail),
							etag: JSON.stringify(cache),
							fetchedAt: new Date(),
						},
					}),
				);
			} catch (e) {
				this.logger.warn(
					`Could not read ${pr.host} ${pr.repo}#${pr.number}: ${e instanceof Error ? e.message : String(e)}`,
				);
				failures?.push(row.id);
				out.push(row);
			}
		}
		return out;
	}

	private async read(
		pr: PrUrl,
		remote: Remote,
		cache: EtagCache,
	): Promise<HostRead> {
		const base = apiBase(pr);
		if (!base) throw new Error(`no API for ${pr.host}`);
		const req = await this.requestFn(base, remote);
		return pr.shape === "gitlab"
			? readGitlab(req, pr.repo, pr.number, cache)
			: readGithub(req, pr.repo, pr.number, cache);
	}

	/**
	 * Bound to the fixed API origin: the credential never leaves it, no redirect is
	 * followed, an answer stops at 1 MB and a request at 10 s (source-request.ts).
	 */
	async requestFn(
		base: string,
		remote: Remote,
	): Promise<AuthenticatedRequestFn> {
		let authorization: string | undefined;
		try {
			const cred = await this.credentials.resolveForUse(remote.ref);
			authorization = cred.authorization(
				cred.effectiveUrl ?? remote.gitUrl,
				"bearer",
			);
		} catch (e) {
			// The machine-git and public tiers read a public repository without a header.
			this.logger.debug?.(
				`No token for ${remote.host}: ${e instanceof Error ? e.message : String(e)}`,
			);
		}
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

	/** A named branch on a GitHub or GitLab remote: its open or latest PR, once a minute at most. */
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
			const shape = workHostOf(remote.host);
			if (shape !== "github" && shape !== "gitlab") continue;
			try {
				const req = await this.requestFn(
					workApiBase(remote.host, shape),
					remote,
				);
				const found = await findByBranch(req, shape, remote.repo, repo.branch);
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

/** The newest PR whose head is `branch`, as its web URL. */
async function findByBranch(
	req: AuthenticatedRequestFn,
	shape: "github" | "gitlab",
	repo: string,
	branch: string,
): Promise<string | null> {
	const owner = repo.split("/")[0] ?? "";
	const path =
		shape === "github"
			? `repos/${repo}/pulls?state=all&per_page=5&head=${encodeURIComponent(`${owner}:${branch}`)}`
			: `projects/${encodeURIComponent(repo)}/merge_requests?per_page=5&source_branch=${encodeURIComponent(branch)}`;
	const res = await req("GET", path, {
		headers: { Accept: "application/json" },
	});
	if (!res.ok) {
		await res.body?.cancel();
		return null;
	}
	const list = (await res.json().catch(() => [])) as unknown;
	const first = Array.isArray(list)
		? (list[0] as Record<string, unknown>)
		: null;
	const url = first?.html_url ?? first?.web_url;
	return typeof url === "string" ? url : null;
}
