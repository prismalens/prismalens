// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Sumit Patel

/**
 * Which credential git uses for one repository, decided before git runs (ADR 0007 §6,
 * #848): the pin, else the one saved token for the host, else an env token, else the
 * machine's own git, else public. An unpinned token that is refused falls through once.
 */
import { tmpdir } from "node:os";
import { Injectable, Logger } from "@nestjs/common";
import type { GitHostView } from "@prismalens/contracts/schemas";
import { isLegacyTemplateId } from "@prismalens/integrations";
import {
	type EnvGitToken,
	envTokenFor,
	GitCredential,
	type GitCredentialDisplay,
	helperName,
	isSshUrl,
	normalizeGitHost,
	urlHost,
} from "../../core/harness/git-credential.js";
import { gitEnv } from "../../core/harness/git-env.js";
import {
	formatDay,
	GitFailure,
	type GitFailureCode,
} from "../../core/harness/git-failure.js";
import {
	effectiveGitUrl,
	GIT_PROBE_TIMEOUT_MS,
	GitSpawnError,
	gitConfigRead,
	spawnGit,
} from "../../core/harness/git-spawn.js";
import { PrismaService } from "../../core/prisma/prisma.service.js";
import { CredentialsService } from "./crypto/credentials.service.js";
import { type HostToken, pickOf, readHostToken } from "./host-token.js";
import { IntegrationsService } from "./integrations.service.js";

export {
	GitCredential,
	type GitCredentialDisplay,
} from "../../core/harness/git-credential.js";
export { isGitHostTemplate, pickOf } from "./host-token.js";
export type GitCredentialSource = GitCredentialDisplay["source"];
type Candidate = NonNullable<
	NonNullable<GitCredentialDisplay["problem"]>["candidates"]
>[number];

/** What both the service row and a run hand in. `pick` is `metadata.credentialConnectionId`; `connectionId` is the discovery link. */
export interface GitRepoRef {
	sourceKind: "folder" | "url";
	url: string;
	connectionId: string | null;
	pick: string | null;
}

export class GitCredentialAmbiguousError extends GitFailure {
	constructor(
		readonly host: string,
		readonly candidates: Candidate[],
	) {
		super(
			"ambiguous",
			`${candidates.length} saved tokens match ${host}: ${candidates.map((c) => c.label).join(", ")}. Pick one on the repository.`,
			"pick-credential",
		);
		this.name = "GitCredentialAmbiguousError";
	}
}

const expired = (t: HostToken, now = new Date()) =>
	!!t.tokenExpiresAt && t.tokenExpiresAt < now;
const usable = (t: HostToken) => t.status === "ACTIVE" && !expired(t);
/** Every saved token for the host but a revoked one: two make an unpinned repository ambiguous (#848). */
const hostTokens = (tokens: HostToken[], host: string | null) =>
	host ? tokens.filter((t) => t.host === host && t.status !== "REVOKED") : [];
const candidateOf = (t: HostToken): Candidate => ({
	connectionId: t.connectionId,
	label: t.label,
	fingerprint: t.fingerprint,
});

function tokenDisplay(t: HostToken): GitCredentialDisplay {
	return {
		source: "connection",
		label: `token ${t.label}`,
		via: `${t.templateId}, fp ${t.fingerprint}`,
		connectionId: t.connectionId,
		fingerprint: t.fingerprint,
	};
}

const FOLDER: GitCredentialDisplay = {
	source: "none",
	label: "folder",
	via: "none",
};
const PUBLIC: GitCredentialDisplay = {
	source: "none",
	label: "public",
	via: "none",
};
const SSH: GitCredentialDisplay = {
	source: "machine",
	label: "machine git (ssh keys)",
	via: "ssh keys",
};

/** Codes on which an unpinned token falls through to the next credential (ADR 0007 §6). */
const FALL_THROUGH_ON: GitFailureCode[] = ["no-access", "token-rejected"];
const PREVIEW_TTL_MS = 60_000;

type Tier = "pin" | "stored" | "env" | "machine" | "public";

interface Resolution {
	display: GitCredentialDisplay;
	effectiveUrl: string;
	tier: Tier;
	token?: HostToken;
	env?: EnvGitToken & { host: string };
}

type ProbeResult =
	| { kind: "none" }
	| { kind: "timeout" }
	| { kind: "machine"; display: GitCredentialDisplay };

@Injectable()
export class GitCredentialService {
	private readonly logger = new Logger(GitCredentialService.name);
	private readonly cache = new Map<
		string,
		{ at: number; value: Promise<GitCredentialDisplay> }
	>();

	constructor(
		private readonly prisma: PrismaService,
		private readonly credentials: CredentialsService,
		private readonly integrations: IntegrationsService,
	) {}

	/** For display. Cached 60 s per (URL, pick). No writes, never throws; problems come back as `display.problem`. */
	preview(ref: GitRepoRef): Promise<GitCredentialDisplay> {
		if (ref.sourceKind === "folder") return Promise.resolve(FOLDER);
		const key = `${ref.url}\0${ref.pick ?? ""}\0${ref.connectionId ?? ""}`;
		const hit = this.cache.get(key);
		if (hit && Date.now() - hit.at < PREVIEW_TTL_MS) return hit.value;
		const value = this.resolve(ref, "preview")
			.then((r) => r.display)
			.catch((err: unknown) => {
				this.logger.warn(
					`Could not work out the credential for ${ref.url}: ${err instanceof Error ? err.message : String(err)}`,
				);
				return PUBLIC;
			});
		this.cache.set(key, { at: Date.now(), value });
		return value;
	}

	/** Drop cached previews, after a pick or a saved token changed. */
	invalidate(): void {
		this.cache.clear();
	}

	/** For a git call. Writes Connection.lastUsedAt for a token; throws GitCredentialAmbiguousError or a GitFailure for an unusable pinned token. */
	async resolveForUse(
		ref: GitRepoRef,
		signal?: AbortSignal,
	): Promise<GitCredential> {
		return this.credentialFor(await this.resolveUse(ref, signal));
	}

	/** resolveForUse, run `fn`, and when an unpinned token is refused (`FALL_THROUGH_ON`), run `fn` once more with the next credential. */
	async withCredential<T>(
		ref: GitRepoRef,
		fn: (cred: GitCredential) => Promise<T>,
		signal?: AbortSignal,
	): Promise<{ result: T; credential: GitCredentialDisplay }> {
		const r = await this.resolveUse(ref, signal);
		const cred = this.credentialFor(r);
		try {
			return { result: await fn(cred), credential: cred.display };
		} catch (err) {
			if (!(err instanceof GitFailure)) throw err;
			await this.recordFailure(cred, err);
			if (
				(r.tier !== "stored" && r.tier !== "env") ||
				!FALL_THROUGH_ON.includes(err.code)
			)
				throw err;
			const host = urlHost(r.effectiveUrl);
			signal?.throwIfAborted();
			const next = await this.after(r.tier, r.effectiveUrl, host, signal);
			const { problem: _problem, ...display } = next.display;
			const fallback = this.credentialFor({
				...next,
				display: {
					...display,
					fallbackFrom: {
						source: cred.display.source,
						label: cred.display.label,
						code: err.code,
					},
				},
			});
			this.logger.log(
				`${host ?? ref.url} answered ${err.code} to ${cred.display.label}; retrying ${ref.url} with ${fallback.display.label}`,
			);
			try {
				return { result: await fn(fallback), credential: fallback.display };
			} catch (retryErr) {
				if (!(retryErr instanceof GitFailure)) throw retryErr;
				await this.recordFailure(fallback, retryErr);
				// The token's own refusal names what to fix; the retry's error would not (#848).
				throw err;
			}
		}
	}

	/** Every git host a token, a repository or an env token names, with what each step holds (#848). */
	async hosts(env: NodeJS.ProcessEnv = process.env): Promise<GitHostView[]> {
		const [tokens, rows] = await Promise.all([
			this.tokens(),
			this.prisma.repository.findMany({
				where: { sourceKind: "url" },
				select: { id: true, url: true, metadata: true },
				orderBy: { createdAt: "asc" },
			}),
		]);
		const repos: {
			host: string;
			repositoryId: string;
			url: string;
			pick: string | null;
		}[] = [];
		for (const row of rows) {
			const effective = await this.effectiveUrl(row.url);
			const host = urlHost(effective);
			if (host && /^https:\/\//i.test(effective))
				repos.push({
					host,
					repositoryId: row.id,
					url: row.url,
					pick: pickOf(row.metadata),
				});
		}
		const envHosts = [
			"github.com",
			"gitlab.com",
			...[env.GH_HOST, env.GITLAB_HOST].map((h) =>
				h ? normalizeGitHost(h) : null,
			),
		].filter((h): h is string => !!h && !!envTokenFor(h, env));
		const hosts = [
			...new Set([
				...tokens.map((t) => t.host),
				...repos.map((r) => r.host),
				...envHosts,
			]),
		].sort();
		const now = new Date();
		return Promise.all(
			hosts.map(async (host): Promise<GitHostView> => {
				const stored = hostTokens(tokens, host);
				const ids = new Set(stored.map((t) => t.connectionId));
				const onHost = repos.filter((r) => r.host === host);
				const ref = ({ repositoryId, url }: (typeof repos)[number]) => ({
					repositoryId,
					url,
				});
				const unpinnedRepos = onHost
					.filter((r) => !r.pick || !ids.has(r.pick))
					.map(ref);
				const envToken = envTokenFor(host, env);
				const helper = await this.urlConfig(
					"credential.helper",
					`https://${host}/`,
				);
				const order: GitHostView["order"] = [];
				if (onHost.some((r) => r.pick && ids.has(r.pick))) order.push("pin");
				if (stored.length) order.push("stored");
				if (envToken) order.push("env");
				if (helper) order.push("machine");
				return {
					host,
					order,
					stored: stored.map((t) => ({
						connectionId: t.connectionId,
						label: t.label,
						fingerprint: t.fingerprint,
						status:
							t.status === "ACTIVE" && expired(t, now)
								? "TOKEN_EXPIRED"
								: t.status,
						testedAt: t.testedAt?.toISOString() ?? null,
						pinnedRepos: onHost
							.filter((r) => r.pick === t.connectionId)
							.map(ref),
					})),
					env: envToken
						? {
								variable: envToken.variable,
								fingerprint: this.fingerprint(host, envToken.token),
							}
						: null,
					machine: helper ? { helper: helperName(helper) ?? helper } : null,
					ambiguous: stored.length > 1 && unpinnedRepos.length > 0,
					unpinnedRepos,
				};
			}),
		);
	}

	/** Saved tokens whose host matches, for the picker. */
	async candidates(url: string): Promise<Candidate[]> {
		const host = urlHost(await this.effectiveUrl(url));
		if (!host) return [];
		return (await this.tokens())
			.filter((t) => t.host === host)
			.map(candidateOf);
	}

	/** The saved token `connectionId`, when it is a git host token for `url`'s host. */
	async tokenFor(url: string, connectionId: string): Promise<HostToken | null> {
		const host = urlHost(await this.effectiveUrl(url));
		const token = (await this.tokens()).find(
			(t) => t.connectionId === connectionId,
		);
		return token && token.host === host ? token : null;
	}

	private async resolveUse(
		ref: GitRepoRef,
		signal?: AbortSignal,
	): Promise<Resolution> {
		if (ref.sourceKind === "folder")
			return { display: FOLDER, effectiveUrl: ref.url, tier: "public" };
		const r = await this.resolve(ref, "use", signal);
		signal?.throwIfAborted();
		if (r.token) await this.markUsed(r.token.connectionId);
		return r;
	}

	private credentialFor(r: Resolution): GitCredential {
		if (r.display === FOLDER) return new GitCredential(FOLDER);
		return new GitCredential(r.display, r.token?.token ?? r.env?.token, {
			effectiveUrl: r.effectiveUrl,
			host: r.token?.host ?? r.env?.host,
		});
	}

	private async resolve(
		ref: GitRepoRef,
		mode: "preview" | "use",
		signal?: AbortSignal,
	): Promise<Resolution> {
		const effectiveUrl = await this.effectiveUrl(ref.url);
		if (isSshUrl(effectiveUrl))
			return { display: SSH, effectiveUrl, tier: "machine" };
		const host = urlHost(effectiveUrl);
		const https = /^https:\/\//i.test(effectiveUrl);
		signal?.throwIfAborted();
		const tokens = await this.tokens();
		const legacy =
			mode === "preview" && ref.connectionId
				? await this.legacyLink(ref.connectionId)
				: undefined;
		const withLegacy = (r: Resolution): Resolution =>
			legacy && !r.display.problem
				? { ...r, display: { ...r.display, problem: legacy } }
				: r;

		if (ref.pick) {
			const picked = tokens.find((t) => t.connectionId === ref.pick);
			if (picked && https && picked.host === host) {
				if (usable(picked))
					return {
						display: tokenDisplay(picked),
						effectiveUrl,
						tier: "pin",
						token: picked,
					};
				const why = expired(picked)
					? `expired on ${formatDay(picked.tokenExpiresAt as Date)}`
					: `in error: ${picked.lastErrorMessage ?? picked.status}`;
				const message = `Pinned token ${picked.label} is ${why}; replace it or set Auto.`;
				if (mode === "use")
					throw new GitFailure(
						expired(picked) ? "token-expired" : "token-rejected",
						message,
						"replace-token",
					);
				return {
					display: {
						...tokenDisplay(picked),
						problem: { code: "pinned-unusable", message },
					},
					effectiveUrl,
					tier: "pin",
				};
			}
			signal?.throwIfAborted();
			const exists = await this.prisma.connection.findUnique({
				where: { id: ref.pick },
				select: { id: true },
			});
			if (exists && mode === "use") await this.clearPick(ref.pick, ref.url);
		}

		const stored = https ? hostTokens(tokens, host) : [];
		if (stored.length > 1) {
			if (mode === "use")
				throw new GitCredentialAmbiguousError(
					host ?? effectiveUrl,
					stored.map(candidateOf),
				);
			return {
				display: {
					source: "none",
					label: "no token chosen",
					via: "none",
					problem: {
						code: "ambiguous",
						message: `${stored.length} saved tokens match ${host}. Pick the one this repository uses.`,
						candidates: stored.map(candidateOf),
					},
				},
				effectiveUrl,
				tier: "stored",
			};
		}
		const [only] = stored;
		if (only?.status === "ACTIVE") {
			if (mode === "use" && expired(only))
				throw new GitFailure(
					"token-expired",
					`Token "${only.label}" expired on ${formatDay(only.tokenExpiresAt as Date)}. Replace it in Settings → Sources.`,
					"replace-token",
				);
			return withLegacy({
				display: tokenDisplay(only),
				effectiveUrl,
				tier: "stored",
				token: only,
			});
		}
		return withLegacy(await this.after("stored", effectiveUrl, host, signal));
	}

	/** The first credential after `tier` in the order: env, the machine's git, public. */
	private async after(
		tier: Tier,
		effectiveUrl: string,
		host: string | null,
		signal?: AbortSignal,
	): Promise<Resolution> {
		const https = /^https:\/\//i.test(effectiveUrl);
		if (tier === "stored" && https && host) {
			const env = envTokenFor(host);
			if (env)
				return {
					display: {
						source: "env",
						label: `env ${env.variable}`,
						via: env.variable,
						envVar: env.variable,
						fingerprint: this.fingerprint(host, env.token),
					},
					effectiveUrl,
					tier: "env",
					env: { ...env, host },
				};
		}
		let probeTimedOut = false;
		if (host) {
			signal?.throwIfAborted();
			const probe = await this.probe(effectiveUrl, host, signal);
			if (probe.kind === "machine")
				return { display: probe.display, effectiveUrl, tier: "machine" };
			if (probe.kind === "timeout") {
				probeTimedOut = true;
				this.logger.warn(
					`The machine's git helper did not answer for ${host} in 5 s`,
				);
			}
		}
		return {
			display: probeTimedOut
				? {
						...PUBLIC,
						problem: {
							code: "probe-timeout",
							message: "Your machine's git helper did not answer in 5 s.",
						},
					}
				: PUBLIC,
			effectiveUrl,
			tier: "public",
		};
	}

	/** The same 8-hex fingerprint a saved token for `host` would show. */
	fingerprint(host: string, token: string): string {
		return this.credentials.getVault().hmacHex(`${host}:${token}`).slice(0, 8);
	}

	private effectiveUrl(url: string): Promise<string> {
		return effectiveGitUrl(url);
	}

	/** The machine's own git (ADR 0007 §6): asks its helper, keeps the username, drops the rest. */
	private async probe(
		effectiveUrl: string,
		host: string,
		signal?: AbortSignal,
	): Promise<ProbeResult> {
		const helper = await this.urlConfig("credential.helper", effectiveUrl);
		if (!helper) return { kind: "none" };
		const useHttpPath =
			(await this.urlConfig("credential.useHttpPath", effectiveUrl)) === "true";
		const u = new URL(effectiveUrl);
		const path = u.pathname.replace(/^\/+/, "");
		const input = `protocol=${u.protocol.replace(/:$/, "")}\nhost=${host}\n${useHttpPath && path ? `path=${path}\n` : ""}\n`;
		let username = "";
		let answered = false;
		try {
			await spawnGit(["credential", "fill"], {
				cwd: tmpdir(),
				env: gitEnv({ source: "machine", coreSshCommand: null }),
				timeoutMs: GIT_PROBE_TIMEOUT_MS,
				...(signal ? { signal } : {}),
				input,
				onStdoutLine: (line) => {
					if (line.startsWith("username=")) username = line.slice(9);
					else if (line.startsWith("password=")) answered = true;
				},
			});
		} catch (err) {
			signal?.throwIfAborted();
			if (err instanceof GitSpawnError && err.timedOut)
				return { kind: "timeout" };
			return { kind: "none" };
		}
		if (!answered) return { kind: "none" };
		const detail = [helperName(helper), username].filter(Boolean).join(", ");
		return {
			kind: "machine",
			display: {
				source: "machine",
				label: detail ? `machine git (${detail})` : "machine git",
				via: helper,
			},
		};
	}

	private async urlConfig(key: string, url: string): Promise<string> {
		try {
			const { stdout } = await gitConfigRead([
				"config",
				"--get-urlmatch",
				key,
				url,
			]);
			return stdout.trim();
		} catch {
			return "";
		}
	}

	private async tokens(): Promise<HostToken[]> {
		const rows = await this.prisma.connection.findMany({
			include: { integration: true },
			orderBy: { createdAt: "asc" },
		});
		return rows
			.map((row) => readHostToken(row, this.credentials))
			.filter((t): t is HostToken => t !== null);
	}

	private async legacyLink(
		connectionId: string,
	): Promise<GitCredentialDisplay["problem"]> {
		const row = await this.prisma.connection.findUnique({
			where: { id: connectionId },
			select: { integration: { select: { templateId: true } } },
		});
		return row && isLegacyTemplateId(row.integration.templateId)
			? {
					code: "legacy-link",
					message:
						"This repository was linked to a removed GitHub App connection. Add a Git host token, or sign your machine's git in.",
				}
			: undefined;
	}

	private async markUsed(connectionId: string): Promise<void> {
		await this.prisma.connection
			.update({ where: { id: connectionId }, data: { lastUsedAt: new Date() } })
			.catch(() => undefined);
	}

	private async recordFailure(
		cred: GitCredential,
		failure: GitFailure,
	): Promise<void> {
		const id = cred.display.connectionId;
		if (
			cred.display.source !== "connection" ||
			!id ||
			(failure.code !== "token-rejected" && failure.code !== "token-expired")
		)
			return;
		await this.integrations
			.recordGitFailure(id, failure)
			.catch((e: unknown) =>
				this.logger.warn(
					`Could not record the git failure on connection ${id}: ${e instanceof Error ? e.message : String(e)}`,
				),
			);
	}

	/** A pick on a connection that is not a git host token for this URL is dropped. */
	private async clearPick(connectionId: string, url: string): Promise<void> {
		const rows = await this.prisma.repository.findMany({
			where: { url, metadata: { contains: connectionId } },
			select: { id: true, metadata: true },
		});
		for (const row of rows) {
			if (pickOf(row.metadata) !== connectionId) continue;
			const meta = JSON.parse(row.metadata as string) as Record<
				string,
				unknown
			>;
			delete meta.credentialConnectionId;
			await this.prisma.repository.update({
				where: { id: row.id },
				data: { metadata: JSON.stringify(meta) },
			});
		}
		this.invalidate();
	}
}
