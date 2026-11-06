// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Sumit Patel

import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { PrismaService } from "../../core/prisma/prisma.service.js";
import type { ImagesService } from "../images/images.service.js";
import type { GitCredentialService } from "../integrations/git-credential.service.js";
import { RepositoriesController } from "./repositories.controller.js";
import type { RepositoriesService } from "./repositories.service.js";
import { RepositoryIconService } from "./repository-icon.service.js";

const PNG = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
const ID = "11111111-1111-4111-8111-111111111111";

let root: string;
beforeEach(() => {
	root = mkdtempSync(join(tmpdir(), "pl-logo-"));
});
afterEach(() => rmSync(root, { recursive: true, force: true }));

function images(enabled = true, opts: { bitbucketDefault?: boolean } = {}) {
	return {
		enabled,
		urlFor: (u: string | undefined, kind: string) => (u && enabled ? `/api/images/${kind}:${u}` : undefined),
		fetch: vi.fn(async (u: string) => ({
			ok: true,
			bytes: PNG,
			type: "image/png",
			finalUrl: opts.bitbucketDefault ? "https://x.public.atl-paas.net/img/repo-avatars/default.png" : u,
		})),
	} as unknown as ImagesService;
}

function store() {
	const rows = new Map<string, { iconKey: string | null; iconCheckedAt: Date | null }>();
	return {
		rows,
		prisma: {
			repository: {
				update: async ({ where, data }: { where: { id: string }; data: { iconKey: string; iconCheckedAt: Date } }) => {
					rows.set(where.id, data);
				},
				findUnique: async () => null,
			},
		} as unknown as PrismaService,
	};
}

const row = (over: Record<string, unknown>) =>
	({
		id: ID,
		sourceKind: "url",
		url: "https://github.com/acme/app.git",
		subPath: null,
		defaultBranch: "main",
		iconKey: null,
		iconCheckedAt: null,
		metadata: null,
		...over,
	}) as never;

/** Recorded host answers, trimmed to the fields the lookup reads. */
const GITLAB_PROJECT = {
	avatar_url: "https://gitlab.com/uploads/-/system/project/avatar/278964/project_avatar.png",
	namespace: { avatar_url: "/uploads/-/system/group/avatar/9970/logo.png" },
};
const BITBUCKET_REPO = {
	links: { avatar: { href: "https://bytebucket.org/ravatar/%7B3d76%7D?ts=default" } },
	owner: { links: { avatar: { href: "https://bitbucket.org/account/atlassian/avatar/" } } },
};

function json(body: unknown) {
	return vi.fn(async () => new Response(JSON.stringify(body), { headers: { "content-type": "application/json" } }));
}

describe("the logo order", () => {
	it("1. the host's repository avatar comes first (GitLab)", async () => {
		const { prisma } = store();
		const s = new RepositoryIconService(prisma, images());
		s.fetchImpl = json(GITLAB_PROJECT) as never;
		s.mirrorRootsFn = () => [];
		const key = await s.refresh(row({ url: "https://gitlab.com/gitlab-org/gitlab.git" }));
		expect(key.h).toBe(GITLAB_PROJECT.avatar_url);
		expect(key.o).toBe("https://gitlab.com/uploads/-/system/group/avatar/9970/logo.png");
		const view = s.view(row({ iconKey: JSON.stringify(key), iconCheckedAt: new Date() }));
		expect(view.iconSource).toBe("host");
	});

	it("1. Bitbucket's repo avatar, unless it is the generic default", async () => {
		const { prisma } = store();
		const s = new RepositoryIconService(prisma, images());
		s.fetchImpl = json(BITBUCKET_REPO) as never;
		s.mirrorRootsFn = () => [];
		expect((await s.refresh(row({ url: "https://bitbucket.org/atlassian/x.git" }))).h).toBeDefined();
		const d = new RepositoryIconService(prisma, images(true, { bitbucketDefault: true }));
		d.fetchImpl = json(BITBUCKET_REPO) as never;
		d.mirrorRootsFn = () => [];
		const key = await d.refresh(row({ url: "https://bitbucket.org/atlassian/x.git" }));
		expect(key.h).toBeUndefined();
		expect(key.o).toBe("https://bitbucket.org/account/atlassian/avatar/");
	});

	it("2. the repo's own icon file before the owner", async () => {
		writeFileSync(join(root, "favicon.png"), PNG);
		const { prisma } = store();
		const s = new RepositoryIconService(prisma, images());
		const key = await s.refresh(row({ sourceKind: "folder", url: root }));
		expect(key).toEqual({ f: "favicon.png" });
		const view = s.view(row({ sourceKind: "folder", url: root, iconKey: JSON.stringify(key), iconCheckedAt: new Date() }));
		expect(view).toEqual({ iconUrl: `/api/repositories/${ID}/icon`, iconSource: "repo" });
	});

	it("3. the owner's avatar, built from a fixed origin for GitHub", async () => {
		const { prisma } = store();
		const s = new RepositoryIconService(prisma, images());
		s.mirrorRootsFn = () => [];
		const key = await s.refresh(row({}));
		expect(key).toEqual({ o: "https://github.com/acme.png" });
		expect(s.view(row({ iconKey: JSON.stringify(key), iconCheckedAt: new Date() })).iconSource).toBe("owner");
	});

	it("4. the monogram covers the rest, and when host images are off", async () => {
		const { prisma } = store();
		const s = new RepositoryIconService(prisma, images(false));
		s.mirrorRootsFn = () => [];
		const key = await s.refresh(row({}));
		expect(key).toEqual({});
		expect(s.view(row({ iconKey: JSON.stringify({ o: "https://github.com/acme.png" }), iconCheckedAt: new Date() }))).toEqual({
			iconSource: "monogram",
		});
	});

	it("a GitHub repo's custom social preview, asked for with the clone credential", async () => {
		const { prisma } = store();
		const credentials = {
			resolveForUse: vi.fn(async () => ({ apiAuthorization: () => "Bearer t" })),
		} as unknown as GitCredentialService;
		const s = new RepositoryIconService(prisma, images(), credentials);
		s.mirrorRootsFn = () => [];
		const fetchImpl = vi.fn(async (_url: string, init?: RequestInit) => {
			expect(new Headers(init?.headers).get("authorization")).toBe("Bearer t");
			return new Response(
				JSON.stringify({
					data: { repository: { usesCustomOpenGraphImage: true, openGraphImageUrl: "https://repository-images.githubusercontent.com/1/abc" } },
				}),
			);
		});
		s.fetchImpl = fetchImpl as never;
		const key = await s.refresh(row({}));
		expect(key.p).toBe("https://repository-images.githubusercontent.com/1/abc");
		expect(s.view(row({ iconKey: JSON.stringify(key), iconCheckedAt: new Date() })).previewUrl).toBe(
			"/api/images/preview:https://repository-images.githubusercontent.com/1/abc",
		);
	});

	it("refreshes a stale find in the background, once", async () => {
		const { prisma, rows } = store();
		const s = new RepositoryIconService(prisma, images());
		s.mirrorRootsFn = () => [];
		const old = new Date(Date.now() - 2 * 3600_000);
		expect(s.view(row({ iconKey: "{}", iconCheckedAt: old }))).toEqual({ iconSource: "monogram" });
		await s.refreshSoon(row({}));
		expect(rows.get(ID)?.iconKey).toBe(JSON.stringify({ o: "https://github.com/acme.png" }));
	});
});

describe("lookups that find nothing", () => {
	it("an ssh address, a host API that fails, and GitHub without a token all fall through", async () => {
		const { prisma } = store();
		const s = new RepositoryIconService(prisma, images());
		s.mirrorRootsFn = () => [];
		expect(await s.refresh(row({ url: "git@github.com:acme/app.git" }))).toEqual({});
		s.fetchImpl = vi.fn(async () => new Response("", { status: 404 })) as never;
		expect(await s.refresh(row({ url: "https://gitlab.example.com/a/b.git" }))).toEqual({});
		s.fetchImpl = vi.fn(async () => {
			throw new Error("offline");
		}) as never;
		expect(await s.refresh(row({ url: "https://bitbucket.org/a/b.git" }))).toEqual({});
		const tokenless = new RepositoryIconService(prisma, images(), {
			resolveForUse: vi.fn(async () => ({ apiAuthorization: () => undefined })),
		} as unknown as GitCredentialService);
		tokenless.mirrorRootsFn = () => [];
		expect((await tokenless.refresh(row({}))).p).toBeUndefined();
	});

	it("scans a project below its repository's top folder", async () => {
		mkdirSync(join(root, "web", "public"), { recursive: true });
		writeFileSync(join(root, "web", "public", "favicon.png"), PNG);
		const { prisma } = store();
		const s = new RepositoryIconService(prisma, images());
		expect(await s.refresh(row({ sourceKind: "folder", url: root, subPath: "web" }))).toEqual({
			f: "public/favicon.png",
		});
	});

	it("reads a remote project's icon from its mirror", async () => {
		const { execFileSync } = await import("node:child_process");
		const { mirrorPathFor } = await import("../../core/harness/repo-source.service.js");
		const url = "https://github.com/acme/app.git";
		const work = join(root, "work");
		mkdirSync(work);
		const git = (...args: string[]) => execFileSync("git", args, { cwd: work, stdio: "pipe" });
		git("init", "-q", "-b", "main");
		git("config", "user.email", "t@example.com");
		git("config", "user.name", "t");
		writeFileSync(join(work, "favicon.png"), PNG);
		git("add", ".");
		git("commit", "-q", "-m", "icon");
		const mirrors = join(root, "mirrors");
		execFileSync("git", ["clone", "-q", "--mirror", work, mirrorPathFor(url, mirrors)]);
		const { prisma } = store();
		const s = new RepositoryIconService(
			Object.assign(prisma, {
				repository: {
					...(prisma as unknown as { repository: object }).repository,
					findUnique: async () => ({ id: ID, sourceKind: "url", url, subPath: null, defaultBranch: "main", iconKey: '{"f":"favicon.png"}' }),
				},
			}) as unknown as PrismaService,
			images(false),
		);
		s.mirrorRootsFn = () => [mirrors];
		expect(await s.refresh(row({ url }))).toEqual({ f: "favicon.png" });
		expect((await s.file(ID))?.type).toBe("image/png");
	}, 30_000);
});

describe("GET /repositories/{id}/icon", () => {
	function res() {
		const headers: Record<string, string> = {};
		const r = {
			headers,
			code: 0,
			body: undefined as Buffer | undefined,
			setHeader: (k: string, v: string) => {
				headers[k.toLowerCase()] = v;
			},
			status(c: number) {
				r.code = c;
				return r;
			},
			end(b?: Buffer) {
				r.body = b;
			},
		};
		return r;
	}

	it("sends an SVG so a script inside it can never run", async () => {
		mkdirSync(join(root, "public"));
		const svg = '<svg xmlns="http://www.w3.org/2000/svg" onload="alert(1)"><script>alert(document.cookie)</script></svg>';
		writeFileSync(join(root, "public", "favicon.svg"), svg);
		const s = new RepositoryIconService(
			{
				repository: {
					findUnique: async () => ({ id: ID, sourceKind: "folder", url: root, subPath: null, iconKey: '{"f":"public/favicon.svg"}' }),
				},
			} as unknown as PrismaService,
			images(),
		);
		const controller = new RepositoriesController({} as RepositoriesService, s);
		const r = res();
		await controller.icon(ID, r as never);
		expect(r.code).toBe(200);
		expect(r.headers["content-type"]).toBe("image/svg+xml");
		expect(r.headers["content-security-policy"]).toMatch(/default-src 'none'/);
		expect(r.headers["content-security-policy"]).toMatch(/sandbox/);
		expect(r.headers["x-content-type-options"]).toBe("nosniff");
	});

	it("404s a stored path that isn't an icon", async () => {
		writeFileSync(join(root, ".env"), "TOKEN=x");
		const s = new RepositoryIconService(
			{
				repository: { findUnique: async () => ({ id: ID, sourceKind: "folder", url: root, subPath: null, iconKey: '{"f":".env"}' }) },
			} as unknown as PrismaService,
			images(),
		);
		const r = res();
		await new RepositoriesController({} as RepositoriesService, s).icon(ID, r as never);
		expect(r.code).toBe(404);
	});
});
