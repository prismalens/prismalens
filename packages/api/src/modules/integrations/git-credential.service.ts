// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Sumit Patel

/**
 * Which credential git uses for one repository, decided before git runs (ADR 0007 §6,
 * #673): an explicit pick, else the machine's own git, else the one saved token for the host.
 */
import { tmpdir } from "node:os";
import { Injectable, Logger } from "@nestjs/common";
import { isLegacyTemplateId } from "@prismalens/integrations";
import {
	GitCredential,
	type GitCredentialDisplay,
	helperName,
	isSshUrl,
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

/** Codes on which the machine's credential is retried with the one matching token (ADR 0007 §6). */
const FALLBACK_ON: GitFailureCode[] = [
	"machine-rejected",
	"no-credential",
	"not-found",
];
const PREVIEW_TTL_MS = 60_000;

interface Resolution {
	display: GitCredentialDisplay;
	effectiveUrl: string;
	token?: HostToken;
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
	async resolveForUse(ref: GitRepoRef): Promise<GitCredential> {
		if (ref.sourceKind === "folder") return new GitCredential(FOLDER);
		const r = await this.resolve(ref, "use");
		if (r.token) await this.markUsed(r.token.connectionId);
		return this.credentialFor(r);
	}

	/** resolveForUse, run `fn`, and on a machine-source refusal with exactly one matching saved token, run `fn` once more with it. */
	async withCredential<T>(
		ref: GitRepoRef,
		fn: (cred: GitCredential) => Promise<T>,
	): Promise<{ result: T; credential: GitCredentialDisplay }> {
		const cred = await this.resolveForUse(ref);
		try {
			return { result: await fn(cred), credential: cred.display };
		} catch (err) {
			if (!(err instanceof GitFailure)) throw err;
			await this.recordFailure(cred, err);
			if (
				cred.display.source !== "machine" ||
				cred.display.via === "ssh keys" ||
				!FALLBACK_ON.includes(err.code)
			)
				throw err;
			const effectiveUrl = cred.effectiveUrl ?? ref.url;
			const host = urlHost(effectiveUrl);
			const matches = host
				? (await this.tokens()).filter((t) => t.host === host && usable(t))
				: [];
			if (matches.length > 1)
				throw new GitFailure(
					err.code,
					`${err.message} Saved tokens for ${host}: ${matches.map((t) => t.label).join(", ")}; pick one on the repository.`,
					"pick-credential",
					err.stderr,
				);
			const [only] = matches;
			if (!only || !/^https:\/\//i.test(effectiveUrl)) throw err;
			this.logger.log(
				`${host} refused the machine's git; retrying ${ref.url} with token ${only.label}`,
			);
			await this.markUsed(only.connectionId);
			const fallback = this.credentialFor({
				display: { ...tokenDisplay(only), fallback: true },
				effectiveUrl,
				token: only,
			});
			try {
				return { result: await fn(fallback), credential: fallback.display };
			} catch (retryErr) {
				if (retryErr instanceof GitFailure)
					await this.recordFailure(fallback, retryErr);
				throw retryErr;
			}
		}
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

	private credentialFor(r: Resolution): GitCredential {
		return new GitCredential(r.display, r.token?.token, {
			effectiveUrl: r.effectiveUrl,
			host: r.token?.host,
		});
	}

	private async resolve(
		ref: GitRepoRef,
		mode: "preview" | "use",
	): Promise<Resolution> {
		const effectiveUrl = await this.effectiveUrl(ref.url);
		if (isSshUrl(effectiveUrl)) return { display: SSH, effectiveUrl };
		const host = urlHost(effectiveUrl);
		const https = /^https:\/\//i.test(effectiveUrl);
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
					return { display: tokenDisplay(picked), effectiveUrl, token: picked };
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
				};
			}
			const exists = await this.prisma.connection.findUnique({
				where: { id: ref.pick },
				select: { id: true },
			});
			if (exists && mode === "use") await this.clearPick(ref.pick, ref.url);
		}

		let probeTimedOut = false;
		if (host) {
			const probe = await this.probe(effectiveUrl, host);
			if (probe.kind === "machine")
				return withLegacy({ display: probe.display, effectiveUrl });
			if (probe.kind === "timeout") {
				probeTimedOut = true;
				this.logger.warn(
					`The machine's git helper did not answer for ${host} in 5 s`,
				);
			}
		}

		const matches = https
			? tokens.filter((t) => t.host === host && t.status === "ACTIVE")
			: [];
		const timeoutProblem = probeTimedOut
			? {
					code: "probe-timeout" as const,
					message: "Your machine's git helper did not answer in 5 s.",
				}
			: undefined;
		if (matches.length > 1) {
			if (mode === "use")
				throw new GitCredentialAmbiguousError(
					host ?? effectiveUrl,
					matches.map(candidateOf),
				);
			return {
				display: {
					source: "none",
					label: "no token chosen",
					via: "none",
					problem: {
						code: "ambiguous",
						message: `${matches.length} saved tokens match ${host}. Pick the one this repository uses.`,
						candidates: matches.map(candidateOf),
					},
				},
				effectiveUrl,
			};
		}
		const [only] = matches;
		if (only) {
			if (mode === "use" && expired(only))
				throw new GitFailure(
					"token-expired",
					`Token "${only.label}" expired on ${formatDay(only.tokenExpiresAt as Date)}. Replace it in Settings → Integrations.`,
					"replace-token",
				);
			const display = tokenDisplay(only);
			return withLegacy({
				display: timeoutProblem
					? { ...display, problem: timeoutProblem }
					: display,
				effectiveUrl,
				token: only,
			});
		}
		return withLegacy({
			display: timeoutProblem ? { ...PUBLIC, problem: timeoutProblem } : PUBLIC,
			effectiveUrl,
		});
	}

	private effectiveUrl(url: string): Promise<string> {
		return effectiveGitUrl(url);
	}

	/** The machine's own git (ADR 0007 §6): asks its helper, keeps the username, drops the rest. */
	private async probe(
		effectiveUrl: string,
		host: string,
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
				input,
				onStdoutLine: (line) => {
					if (line.startsWith("username=")) username = line.slice(9);
					else if (line.startsWith("password=")) answered = true;
				},
			});
		} catch (err) {
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
