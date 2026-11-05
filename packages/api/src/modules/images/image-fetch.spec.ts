// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Sumit Patel

import { describe, expect, it, vi } from "vitest";
import { allowedImageUrl, fetchImage, IMAGE_CAP } from "./image-fetch.js";

const ctx = { gitlabHosts: ["gitlab.com", "gitlab.example.com"], gravatar: false };
const PNG = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 1, 2, 3]);

function png(extra: Record<string, string> = {}, body: Buffer = PNG) {
	return new Response(new Uint8Array(body), { status: 200, headers: { "content-type": "image/png", ...extra } });
}

describe("allowedImageUrl", () => {
	// Each URL is one a host really answered with on 2026-11-06 (#1024 E).
	it.each([
		"https://github.com/octocat.png",
		"https://avatars.githubusercontent.com/u/583231?v=4",
		"https://repository-images.githubusercontent.com/1/abc",
		"https://opengraph.githubassets.com/1/acme/app",
		"https://bitbucket.org/account/atlassian/avatar/",
		"https://bytebucket.org/ravatar/%7B3d76c1e2%7D?ts=default",
		"https://bitbucket-assetroot.s3.amazonaws.com/c/photos/2017/Oct/05/a.png",
		"https://bbc-core-bifrost.prod-east.frontend.public.atl-paas.net/assets/x/default.png",
		"https://gitlab.com/uploads/-/system/project/avatar/278964/project_avatar.png?v=1",
		"https://gitlab.example.com/uploads/-/system/group/avatar/9/logo.png",
	])("allows %s", (url) => {
		expect(allowedImageUrl(url, ctx)).not.toBeNull();
	});

	it.each([
		"http://avatars.githubusercontent.com/u/1",
		"https://evil.example/a.png",
		"https://github.com/acme/app/raw/main/logo.png",
		"https://bitbucket.org/acme/repo/raw/main/x.png",
		"https://user:pw@avatars.githubusercontent.com/u/1",
		"https://avatars.githubusercontent.com:8443/u/1",
		"https://gitlab.example.com/api/v4/projects/1",
		"https://other-gitlab.example/uploads/a.png",
		"https://secure.gravatar.com/avatar/abc",
		"https://169.254.169.254/latest/meta-data",
	])("refuses %s", (url) => {
		expect(allowedImageUrl(url, ctx)).toBeNull();
	});

	it("lets Gravatar through only for a URL a host's API returned", () => {
		expect(allowedImageUrl("https://secure.gravatar.com/avatar/abc", { ...ctx, gravatar: true })).not.toBeNull();
	});
});

describe("fetchImage", () => {
	it("follows a redirect that stays on allowed origins, without credentials", async () => {
		const fetchImpl = vi.fn(async (url: string, init?: RequestInit) => {
			expect(init?.credentials).toBe("omit");
			expect(new Headers(init?.headers).has("authorization")).toBe(false);
			expect(new Headers(init?.headers).has("cookie")).toBe(false);
			return url.startsWith("https://github.com/")
				? new Response(null, { status: 302, headers: { location: "https://avatars.githubusercontent.com/u/583231?v=4" } })
				: png();
		});
		const got = await fetchImage("https://github.com/octocat.png", "avatar", ctx, fetchImpl as never);
		expect(got).toMatchObject({ ok: true, type: "image/png", finalUrl: "https://avatars.githubusercontent.com/u/583231?v=4" });
		expect(fetchImpl).toHaveBeenCalledTimes(2);
	});

	it("refuses a redirect off the allowed origins", async () => {
		const fetchImpl = vi.fn(async () => new Response(null, { status: 302, headers: { location: "https://evil.example/x.png" } }));
		expect(await fetchImage("https://github.com/octocat.png", "avatar", ctx, fetchImpl as never)).toEqual({ ok: false, reason: "origin" });
		expect(fetchImpl).toHaveBeenCalledOnce();
	});

	it("refuses an unlisted origin without fetching", async () => {
		const fetchImpl = vi.fn();
		expect(await fetchImage("https://evil.example/x.png", "avatar", ctx, fetchImpl as never)).toEqual({ ok: false, reason: "origin" });
		expect(fetchImpl).not.toHaveBeenCalled();
	});

	it("refuses a non-image type", async () => {
		const fetchImpl = async () => new Response("<html>", { headers: { "content-type": "text/html" } });
		expect(await fetchImage("https://avatars.githubusercontent.com/u/1", "avatar", ctx, fetchImpl as never)).toEqual({ ok: false, reason: "type" });
	});

	it("refuses an oversize body, declared or streamed", async () => {
		const big = Buffer.alloc(IMAGE_CAP.avatar + 1);
		const declared = async () => png({ "content-length": String(big.length) }, big);
		expect(await fetchImage("https://avatars.githubusercontent.com/u/1", "avatar", ctx, declared as never)).toEqual({ ok: false, reason: "size" });
		const streamed = async () =>
			new Response(new Blob([new Uint8Array(big)]).stream(), { headers: { "content-type": "image/png" } });
		expect(await fetchImage("https://avatars.githubusercontent.com/u/1", "avatar", ctx, streamed as never)).toEqual({ ok: false, reason: "size" });
		const preview = async () => png({}, big);
		expect((await fetchImage("https://opengraph.githubassets.com/1/a/b", "preview", ctx, preview as never)).ok).toBe(true);
	});

	it("reports a failed request and a bad status", async () => {
		const down = async () => {
			throw new Error("ECONNRESET");
		};
		expect(await fetchImage("https://avatars.githubusercontent.com/u/1", "avatar", ctx, down as never)).toEqual({ ok: false, reason: "network" });
		const missing = async () => new Response(null, { status: 404 });
		expect(await fetchImage("https://avatars.githubusercontent.com/u/1", "avatar", ctx, missing as never)).toEqual({ ok: false, reason: "status" });
	});

	it("gives up after three redirects", async () => {
		const loop = async () => new Response(null, { status: 302, headers: { location: "https://avatars.githubusercontent.com/u/1" } });
		expect(await fetchImage("https://avatars.githubusercontent.com/u/1", "avatar", ctx, loop as never)).toEqual({ ok: false, reason: "redirects" });
	});
});
