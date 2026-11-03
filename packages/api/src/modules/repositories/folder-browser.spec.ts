// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Sumit Patel

import {
	mkdirSync,
	mkdtempSync,
	rmSync,
	symlinkSync,
	writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { ACCESS_SCOPE } from "@prismalens/auth";
import type { Request } from "express";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { browseFolders } from "./folder-browser.js";
import { RepositoriesController } from "./repositories.controller.js";
import type { RepositoriesService } from "./repositories.service.js";

let root: string;
beforeEach(() => {
	root = mkdtempSync(join(tmpdir(), "pl-browse-"));
});
afterEach(() => rmSync(root, { recursive: true, force: true }));

const dirLink = (target: string, path: string) =>
	symlinkSync(target, path, process.platform === "win32" ? "junction" : "dir");

describe("the host's folder listing (#1020)", () => {
	it("lists folders only: a file's name never comes back", async () => {
		mkdirSync(join(root, "api"));
		mkdirSync(join(root, ".cache"));
		writeFileSync(join(root, "secret-plans.txt"), "x");
		const got = await browseFolders(root);
		expect(got.ok).toBe(true);
		if (!got.ok) return;
		expect(got.entries.map((e) => e.name)).toEqual([".cache", "api"]);
		expect(got.entries.find((e) => e.name === ".cache")?.hidden).toBe(true);
		expect(JSON.stringify(got)).not.toContain("secret-plans");
	});

	it("never lists or follows a link or junction", async () => {
		const outside = mkdtempSync(join(tmpdir(), "pl-outside-"));
		try {
			mkdirSync(join(outside, "behind-the-link"));
			dirLink(outside, join(root, "door"));
			const got = await browseFolders(root);
			expect(got.ok && got.entries).toEqual([]);
			expect(await browseFolders(join(root, "door"))).toMatchObject({
				ok: false,
				error: "not-folder",
			});
			expect(JSON.stringify(await browseFolders(root))).not.toContain(
				"behind-the-link",
			);
		} finally {
			rmSync(outside, { recursive: true, force: true });
		}
	});

	it("refuses a path that reaches its folder through a linked parent (#1020)", async () => {
		mkdirSync(join(root, "real", "inner"), { recursive: true });
		dirLink(join(root, "real"), join(root, "alias"));
		expect(await browseFolders(join(root, "alias", "inner"))).toMatchObject({
			ok: false,
			error: "link",
		});
		const fine = await browseFolders(join(root, "real", "inner"));
		expect(fine.ok).toBe(true);
	});

	it("marks git folders and says when the folder itself is in a repo", async () => {
		mkdirSync(join(root, "shop", ".git"), { recursive: true });
		mkdirSync(join(root, "shop", "api"));
		mkdirSync(join(root, "notes"));
		const top = await browseFolders(root);
		expect(top.ok && top.entries.map((e) => [e.name, e.git])).toEqual([
			["notes", false],
			["shop", true],
		]);
		const inner = await browseFolders(join(root, "shop", "api"));
		expect(inner.ok && inner.git).toBe(true);
		expect(inner.ok && inner.parent).toBe(join(root, "shop"));
	});

	it("caps the count and says it was cut", async () => {
		for (const n of ["a", "b", "c", "d"]) mkdirSync(join(root, n));
		const got = await browseFolders(root, { max: 2 });
		expect(got.ok && got.entries.length).toBe(2);
		expect(got.ok && got.truncated).toBe(true);
	});

	it("tells missing, not a folder, not absolute, network paths and timeout apart", async () => {
		writeFileSync(join(root, "f"), "x");
		expect(await browseFolders(join(root, "nope"))).toMatchObject({
			ok: false,
			error: "missing",
		});
		expect(await browseFolders(join(root, "f"))).toMatchObject({
			ok: false,
			error: "not-folder",
		});
		expect(await browseFolders("relative/dir")).toMatchObject({
			ok: false,
			error: "not-absolute",
		});
		expect(await browseFolders("\\\\evil-host\\share")).toMatchObject({
			ok: false,
			error: "not-absolute",
		});
		expect(await browseFolders("//evil-host/share")).toMatchObject({
			ok: false,
			error: "not-absolute",
		});
		expect(await browseFolders(root, { readMs: 0 })).toMatchObject({
			ok: false,
			error: "timeout",
		});
	});

	it("null and ~ list the host's home", async () => {
		mkdirSync(join(root, "code"));
		const home = await browseFolders(null, { home: root });
		expect(home.ok && home.path).toBe(root);
		const tilde = await browseFolders("~/code", { home: root });
		expect(tilde.ok && tilde.path).toBe(join(root, "code"));
	});
});

describe("host-only folder routes (#1020)", () => {
	const service = { startGit: vi.fn() };
	const controller = new RepositoriesController(
		service as unknown as RepositoriesService,
	);
	// biome-ignore lint/suspicious/noExplicitAny: oRPC handler extraction
	const procs = controller.repositories() as Record<string, any>;
	const device = {
		operator: { device: { scopes: [] } },
	} as unknown as Request;
	const host = {
		operator: { device: { scopes: [ACCESS_SCOPE] } },
	} as unknown as Request;

	it("a paired device gets 403 for the listing and for Start git here", async () => {
		await expect(
			procs.browseFolders["~orpc"].handler({
				input: { path: root },
				context: { request: device },
			}),
		).rejects.toMatchObject({ code: "FORBIDDEN" });
		await expect(
			procs.startGit["~orpc"].handler({
				input: { id: "00000000-0000-4000-8000-000000000000" },
				context: { request: device },
			}),
		).rejects.toMatchObject({ code: "FORBIDDEN" });
		expect(service.startGit).not.toHaveBeenCalled();
	});

	it("the host's own session lists", async () => {
		mkdirSync(join(root, "api"));
		const got = await procs.browseFolders["~orpc"].handler({
			input: { path: root },
			context: { request: host },
		});
		expect(got.ok && got.entries.map((e: { name: string }) => e.name)).toEqual([
			"api",
		]);
	});
});
