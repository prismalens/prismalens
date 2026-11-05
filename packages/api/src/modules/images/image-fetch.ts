// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Sumit Patel

/**
 * The image proxy's outbound rules (#1024 E): which origins it may fetch from,
 * and how. No credentials, image types only, a size cap, a 5 s timeout, and
 * redirects followed only while they stay on an allowed origin.
 */

export type ImageKind = "avatar" | "preview";

export const IMAGE_CAP: Record<ImageKind, number> = {
	avatar: 256 * 1024,
	preview: 1024 * 1024,
};

const TIMEOUT_MS = 5_000;
const MAX_REDIRECTS = 3;

export interface OriginContext {
	/** GitLab origins this install clones from, gitlab.com included. */
	gitlabHosts: string[];
	/** The URL came from a host's own API; kept for callers, email-hash services stay refused. */
	gravatar: boolean;
}

/**
 * Origins confirmed against live answers on 2026-11-06: GitHub's `/<owner>.png`
 * redirects to avatars.githubusercontent.com; Bitbucket's account avatar to
 * bitbucket-assetroot.s3.amazonaws.com and repo avatars via bytebucket.org to
 * *.public.atl-paas.net; GitLab serves `/uploads/…` on its own origin.
 */
const FIXED: Array<{ host: string | RegExp; path?: RegExp }> = [
	{ host: "github.com", path: /^\/[A-Za-z0-9](?:[A-Za-z0-9-]{0,38})\.png$/ },
	{ host: "avatars.githubusercontent.com" },
	{ host: "repository-images.githubusercontent.com" },
	{ host: "opengraph.githubassets.com" },
	{ host: "bitbucket.org", path: /^\/account\/[^/]+\/avatar\/?$/ },
	{ host: "bytebucket.org", path: /^\/ravatar\// },
	{ host: "bitbucket-assetroot.s3.amazonaws.com" },
	{ host: /^[a-z0-9-]+(?:\.[a-z0-9-]+)*\.public\.atl-paas\.net$/ },
];

/** The URL when the proxy may fetch it, else null. */
export function allowedImageUrl(raw: string, ctx: OriginContext): URL | null {
	let url: URL;
	try {
		url = new URL(raw);
	} catch {
		return null;
	}
	if (url.protocol !== "https:" || url.username || url.password || url.port)
		return null;
	const host = url.hostname.toLowerCase();
	const fixed = FIXED.some(
		(rule) =>
			(typeof rule.host === "string"
				? rule.host === host
				: rule.host.test(host)) &&
			(!rule.path || rule.path.test(url.pathname)),
	);
	if (fixed) return url;
	if (ctx.gitlabHosts.includes(host) && url.pathname.startsWith("/uploads/"))
		return url;
	// Email-hash avatar services (Gravatar, Libravatar) are never fetched, even from a host's API (#1024).
	return null;
}

export type FetchedImage =
	| { ok: true; bytes: Buffer; type: string; finalUrl: string }
	| {
			ok: false;
			reason: "origin" | "status" | "type" | "size" | "network" | "redirects";
	  };

async function readCapped(res: Response, cap: number): Promise<Buffer | null> {
	const declared = Number(res.headers.get("content-length"));
	if (Number.isFinite(declared) && declared > cap) return null;
	if (!res.body) return Buffer.alloc(0);
	const chunks: Buffer[] = [];
	let size = 0;
	const reader = res.body.getReader();
	for (;;) {
		const { done, value } = await reader.read();
		if (done) break;
		size += value.byteLength;
		if (size > cap) {
			await reader.cancel().catch(() => {});
			return null;
		}
		chunks.push(Buffer.from(value));
	}
	return Buffer.concat(chunks);
}

/** Fetch one image under the rules above; never sends a cookie or an Authorization header. */
export async function fetchImage(
	raw: string,
	kind: ImageKind,
	ctx: OriginContext,
	fetchImpl: typeof fetch = fetch,
): Promise<FetchedImage> {
	let url = allowedImageUrl(raw, ctx);
	if (!url) return { ok: false, reason: "origin" };
	const signal = AbortSignal.timeout(TIMEOUT_MS);
	try {
		for (let hop = 0; hop <= MAX_REDIRECTS; hop++) {
			const res = await fetchImpl(url.toString(), {
				method: "GET",
				redirect: "manual",
				credentials: "omit",
				headers: { accept: "image/*" },
				signal,
			});
			if (res.status >= 300 && res.status < 400) {
				const next = res.headers.get("location");
				url = next ? allowedImageUrl(new URL(next, url).toString(), ctx) : null;
				if (!url) return { ok: false, reason: "origin" };
				continue;
			}
			if (!res.ok) return { ok: false, reason: "status" };
			const type = (res.headers.get("content-type") ?? "")
				.split(";")[0]
				.trim()
				.toLowerCase();
			if (!type.startsWith("image/")) return { ok: false, reason: "type" };
			const bytes = await readCapped(res, IMAGE_CAP[kind]);
			if (!bytes) return { ok: false, reason: "size" };
			return { ok: true, bytes, type, finalUrl: url.toString() };
		}
		return { ok: false, reason: "redirects" };
	} catch {
		return { ok: false, reason: "network" };
	}
}
