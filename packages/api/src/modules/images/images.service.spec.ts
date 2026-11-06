// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Sumit Patel

import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { PrismaService } from "../../core/prisma/prisma.service.js";
import { HOST_IMAGES_SETTING, ImagesService } from "./images.service.js";

const PNG = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
let dir: string;
beforeEach(() => {
	dir = mkdtempSync(join(tmpdir(), "pl-images-"));
});
afterEach(() => rmSync(dir, { recursive: true, force: true }));

function prisma(initial: Record<string, string> = {}) {
	const settings = new Map(Object.entries(initial));
	return {
		settings,
		prisma: {
			setting: {
				findMany: async () => [...settings].map(([key, value]) => ({ key, value })),
				upsert: async ({ where, create }: { where: { key: string }; create: { value: string } }) => {
					settings.set(where.key, create.value);
				},
			},
			repository: {
				findMany: async () => [{ url: "https://gitlab.example.com/a/b.git" }, { url: "git@x:y/z.git" }],
			},
		} as unknown as PrismaService,
	};
}

async function service(initial?: Record<string, string>) {
	const { prisma: p, settings } = prisma(initial);
	const s = new ImagesService(p);
	s.cacheDir = () => dir;
	await s.load();
	return { s, settings };
}

describe("ImagesService", () => {
	it("signs a key once per workspace and keeps it", async () => {
		const { s, settings } = await service();
		const url = s.urlFor("https://avatars.githubusercontent.com/u/1", "avatar");
		expect(url).toMatch(/^\/api\/images\/[\w-]+\.[\w-]+$/);
		const again = new ImagesService(prisma(Object.fromEntries(settings)).prisma);
		await again.load();
		expect(again.urlFor("https://avatars.githubusercontent.com/u/1", "avatar")).toBe(url);
	});

	it("refuses an unsigned, forged or re-pointed key", async () => {
		const { s } = await service();
		const key = (s.urlFor("https://avatars.githubusercontent.com/u/1", "avatar") as string).split("/").pop() as string;
		expect(s.verify(key)).toMatchObject({ u: "https://avatars.githubusercontent.com/u/1", k: "avatar" });
		const [, mac] = key.split(".");
		const other = Buffer.from(JSON.stringify({ u: "https://evil.example/x", k: "avatar" })).toString("base64url");
		expect(s.verify(`${other}.${mac}`)).toBeNull();
		expect(s.verify(other)).toBeNull();
		expect(await s.serve(`${other}.${mac}`)).toBeNull();
	});

	it("gives no URL for an origin it would never fetch", async () => {
		const { s } = await service();
		expect(s.urlFor("https://evil.example/x.png", "avatar")).toBeUndefined();
		expect(s.urlFor("https://secure.gravatar.com/avatar/x", "avatar")).toBeUndefined();
		expect(s.urlFor("https://secure.gravatar.com/avatar/x", "avatar", { fromHostApi: true })).toBeUndefined();
	});

	it("serves through the cache, and a GitLab origin only when this install clones from it", async () => {
		const { s } = await service();
		const fetchImpl = vi.fn(async () => new Response(new Uint8Array(PNG), { headers: { "content-type": "image/png" } }));
		s.fetchImpl = fetchImpl as never;
		const ok = s.urlFor("https://gitlab.example.com/uploads/a.png", "avatar") as string;
		expect(await s.serve(ok.split("/").pop() as string)).toMatchObject({ type: "image/png" });
		expect(await s.serve(ok.split("/").pop() as string)).toMatchObject({ type: "image/png" });
		expect(fetchImpl).toHaveBeenCalledOnce();
		const stranger = s.urlFor("https://other.example/uploads/a.png", "avatar") as string;
		expect(await s.serve(stranger.split("/").pop() as string)).toBeNull();
	});

	it("stops every remote image when Images from the git host is off", async () => {
		const { s, settings } = await service();
		const key = (s.urlFor("https://avatars.githubusercontent.com/u/1", "avatar") as string).split("/").pop() as string;
		expect(await s.setEnabled(false)).toBe(false);
		expect(settings.get(HOST_IMAGES_SETTING)).toBe("false");
		expect(s.urlFor("https://avatars.githubusercontent.com/u/1", "avatar")).toBeUndefined();
		expect(await s.serve(key)).toBeNull();
		const off = await service({ [HOST_IMAGES_SETTING]: "false" });
		expect(off.s.enabled).toBe(false);
	});
});
