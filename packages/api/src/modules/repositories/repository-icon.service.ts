// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Sumit Patel

/**
 * A project's logo and social preview (#1024 E). Tried in order: the host's
 * repository avatar, the repo's own icon file, the owner's avatar, then the
 * monogram. Found once and kept on the row (`iconKey`) for 24 h, or 1 h when
 * nothing was found; a read never waits for the network.
 */

import { existsSync } from "node:fs";
import { join } from "node:path";
import { Injectable, Logger, Optional } from "@nestjs/common";
import type { IconSource } from "@prismalens/contracts";
import type { Repository as PrismaRepository } from "@prismalens/database";
import { mirrorRoots } from "../../core/harness/mirror-location.js";
import { mirrorPathFor } from "../../core/harness/repo-source.service.js";
import { PrismaService } from "../../core/prisma/prisma.service.js";
import { API_GLOBAL_PREFIX } from "../../shared/constants/routes.js";
import { ImagesService } from "../images/images.service.js";
import {
	GitCredentialService,
	pickOf,
} from "../integrations/git-credential.service.js";
import {
	type FoundIcon,
	folderReader,
	isIconPathShape,
	mirrorReader,
	readFolderIcon,
	readMirrorIcon,
	scanIcon,
} from "./repo-icon-scan.js";

const FOUND_TTL_MS = 24 * 60 * 60 * 1000;
const NONE_TTL_MS = 60 * 60 * 1000;
const API_TIMEOUT_MS = 5_000;

/** What `iconKey` holds: each tier's find, so the setting can skip the remote ones at read time. */
export interface IconKey {
	/** The host's repository avatar URL. */
	h?: string;
	/** The repo-relative icon file. */
	f?: string;
	/** The owner's avatar URL. */
	o?: string;
	/** A GitHub repo's custom social preview URL. */
	p?: string;
	/** `h` or `o` came from a host API, so Gravatar may serve it. */
	g?: 1;
}

export interface IconView {
	iconUrl?: string;
	iconSource: IconSource;
	previewUrl?: string;
}

type Row = Pick<
	PrismaRepository,
	| "id"
	| "sourceKind"
	| "url"
	| "subPath"
	| "defaultBranch"
	| "iconKey"
	| "iconCheckedAt"
> & { fullName?: string; metadata?: unknown };

export function parseIconKey(raw: string | null): IconKey | null {
	if (!raw) return null;
	try {
		const v = JSON.parse(raw) as IconKey;
		return v && typeof v === "object" ? v : null;
	} catch {
		return null;
	}
}

function ownerAndName(
	url: string,
): { host: string; owner: string; path: string } | null {
	try {
		const u = new URL(url);
		if (u.protocol !== "https:") return null;
		const path = u.pathname
			.replace(/^\/+/, "")
			.replace(/\.git$/, "")
			.replace(/\/+$/, "");
		const owner = path.split("/")[0];
		return owner ? { host: u.hostname.toLowerCase(), owner, path } : null;
	} catch {
		return null;
	}
}

@Injectable()
export class RepositoryIconService {
	private readonly logger = new Logger(RepositoryIconService.name);
	private readonly refreshing = new Map<string, Promise<void>>();

	// Fields rather than constructor parameters: Nest would try to inject them. Tests set them.
	fetchImpl: typeof fetch = fetch;
	now: () => number = Date.now;
	mirrorRootsFn: () => string[] = mirrorRoots;

	constructor(
		private readonly prisma: PrismaService,
		private readonly images: ImagesService,
		@Optional() private readonly credentials?: GitCredentialService,
	) {}

	/** The logo, source and preview a read shows; schedules a refresh when the find is stale. */
	view(repo: Row): IconView {
		const key = parseIconKey(repo.iconKey);
		if (this.stale(repo, key)) this.refreshSoon(repo);
		if (!key) return { iconSource: "monogram" };
		const remote = (u: string | undefined, kind: "avatar" | "preview") =>
			this.images.urlFor(u, kind, { fromHostApi: key.g === 1 });
		const preview = remote(key.p, "preview");
		const pick = ((): Omit<IconView, "previewUrl"> => {
			const host = remote(key.h, "avatar");
			if (host) return { iconUrl: host, iconSource: "host" };
			if (key.f)
				return {
					iconUrl: `/${API_GLOBAL_PREFIX}/repositories/${repo.id}/icon`,
					iconSource: "repo",
				};
			const owner = remote(key.o, "avatar");
			if (owner) return { iconUrl: owner, iconSource: "owner" };
			return { iconSource: "monogram" };
		})();
		return preview ? { ...pick, previewUrl: preview } : pick;
	}

	private stale(repo: Row, key: IconKey | null): boolean {
		if (!repo.iconCheckedAt) return true;
		const found = !!key && Object.keys(key).length > 0;
		return (
			this.now() - repo.iconCheckedAt.getTime() >=
			(found ? FOUND_TTL_MS : NONE_TTL_MS)
		);
	}

	refreshSoon(repo: Row): Promise<void> {
		const running = this.refreshing.get(repo.id);
		if (running) return running;
		const work = this.refresh(repo)
			.then(() => undefined)
			.catch((e: Error) =>
				this.logger.debug(`Logo lookup for ${repo.id} failed: ${e.message}`),
			)
			.finally(() => this.refreshing.delete(repo.id));
		this.refreshing.set(repo.id, work);
		return work;
	}

	/** Look for every tier and store what was found. */
	async refresh(repo: Row): Promise<IconKey> {
		const key: IconKey = {};
		const file = await this.scan(repo);
		if (file) key.f = file.path;
		if (repo.sourceKind !== "folder" && this.images.enabled)
			Object.assign(key, await this.remote(repo));
		await this.prisma.repository.update({
			where: { id: repo.id },
			data: {
				iconKey: JSON.stringify(key),
				iconCheckedAt: new Date(this.now()),
			},
		});
		return key;
	}

	/** The repo's own icon file: the folder, or the mirror at the default branch. */
	async scan(repo: Row): Promise<FoundIcon | null> {
		if (repo.sourceKind === "folder") {
			const root = repo.subPath
				? join(repo.url, ...repo.subPath.split("/"))
				: repo.url;
			const r = folderReader(root);
			return scanIcon(r.read, r.index);
		}
		const mirror = this.mirrorOf(repo.url);
		if (!mirror) return null;
		const r = mirrorReader(mirror, repo.defaultBranch || "HEAD");
		return scanIcon(r.read, r.index);
	}

	private mirrorOf(url: string): string | null {
		for (const root of this.mirrorRootsFn()) {
			try {
				const mirror = mirrorPathFor(url, root);
				if (existsSync(join(mirror, "HEAD"))) return mirror;
			} catch {
				return null;
			}
		}
		return null;
	}

	/** The bytes `GET /repositories/{id}/icon` sends: the stored path, read again under the same checks. */
	async file(id: string): Promise<FoundIcon | null> {
		const repo = await this.prisma.repository.findUnique({ where: { id } });
		const key = parseIconKey(repo?.iconKey ?? null);
		if (!repo || !key?.f || !isIconPathShape(key.f)) return null;
		if (repo.sourceKind === "folder") {
			const root = repo.subPath
				? join(repo.url, ...repo.subPath.split("/"))
				: repo.url;
			return readFolderIcon(root, key.f);
		}
		const mirror = this.mirrorOf(repo.url);
		return mirror
			? readMirrorIcon(mirror, repo.defaultBranch || "HEAD", key.f)
			: null;
	}

	private async getJson(
		url: string,
		authorization?: string,
		body?: string,
	): Promise<unknown> {
		const res = await this.fetchImpl(url, {
			method: body ? "POST" : "GET",
			redirect: "error",
			headers: {
				accept: "application/json",
				...(body ? { "content-type": "application/json" } : {}),
				...(authorization ? { authorization } : {}),
			},
			...(body ? { body } : {}),
			signal: AbortSignal.timeout(API_TIMEOUT_MS),
		});
		return res.ok ? res.json() : null;
	}

	/** The host and owner avatars, and a GitHub repo's custom social preview. */
	private async remote(repo: Row): Promise<IconKey> {
		const where = ownerAndName(repo.url);
		if (!where) return {};
		const { host, owner, path } = where;
		const obj = (v: unknown) =>
			v && typeof v === "object" ? (v as Record<string, unknown>) : {};
		const str = (v: unknown) => (typeof v === "string" && v ? v : undefined);
		try {
			if (host === "github.com") {
				const out: IconKey = { o: `https://github.com/${owner}.png` };
				const preview = await this.githubPreview(
					repo.url,
					path,
					repo.metadata,
				).catch(() => undefined);
				if (preview) out.p = preview;
				return out;
			}
			if (host === "bitbucket.org") {
				const body = obj(
					await this.getJson(
						`https://api.bitbucket.org/2.0/repositories/${path}`,
					),
				);
				const out: IconKey = {};
				const h = str(obj(obj(body.links).avatar).href);
				// A repo with no avatar of its own answers with Bitbucket's generic one.
				if (h) {
					const got = await this.images.fetch(h, "avatar");
					if (got.ok && !got.finalUrl.includes("/repo-avatars/default"))
						out.h = h;
				}
				const o = str(obj(obj(obj(body.owner).links).avatar).href);
				if (o) out.o = o;
				return out;
			}
			// Any other host is tried as GitLab; a public project answers without a token.
			const body = obj(
				await this.getJson(
					`https://${host}/api/v4/projects/${encodeURIComponent(path)}`,
				),
			);
			const abs = (v: unknown) => {
				const s = str(v);
				if (!s) return undefined;
				try {
					return new URL(s, `https://${host}`).toString();
				} catch {
					return undefined;
				}
			};
			const out: IconKey = { g: 1 };
			const h = abs(body.avatar_url);
			if (h) out.h = h;
			const o = abs(obj(body.namespace).avatar_url);
			if (o) out.o = o;
			return out.h || out.o ? out : {};
		} catch {
			return {};
		}
	}

	/** GitHub's GraphQL needs a token; without one there is no preview. */
	private async githubPreview(
		url: string,
		path: string,
		metadata: unknown,
	): Promise<string | undefined> {
		if (!this.credentials) return undefined;
		const [owner, name] = path.split("/");
		if (!owner || !name) return undefined;
		const cred = await this.credentials.resolveForUse({
			sourceKind: "url",
			url,
			connectionId: null,
			pick: pickOf(metadata),
		});
		const endpoint = "https://api.github.com/graphql";
		const authorization = cred.apiAuthorization(endpoint);
		if (!authorization) return undefined;
		const body = (await this.getJson(
			endpoint,
			authorization,
			JSON.stringify({
				query:
					"query($o:String!,$n:String!){repository(owner:$o,name:$n){usesCustomOpenGraphImage openGraphImageUrl}}",
				variables: { o: owner, n: name },
			}),
		)) as {
			data?: {
				repository?: {
					usesCustomOpenGraphImage?: boolean;
					openGraphImageUrl?: string;
				};
			};
		} | null;
		const r = body?.data?.repository;
		return r?.usesCustomOpenGraphImage && r.openGraphImageUrl
			? r.openGraphImageUrl
			: undefined;
	}
}
