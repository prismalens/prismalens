// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Sumit Patel

import { mkdirSync, mkdtempSync, rmSync, symlinkSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { describe, expect, it, vi } from "vitest";
import {
	folderBusy,
	holdConversion,
	overlaps,
	sameAsDisk,
} from "./folder-lock.js";

const at = (...p: string[]) => resolve("/", "code", ...p);

function db(
	repo: { plain: boolean; url: string } | null,
	live: Array<{ repository: { url: string } | null }>,
) {
	return {
		repository: { findUnique: vi.fn(async () => repo) },
		investigation: { findMany: vi.fn(async () => live) },
	};
}

describe("one live run per plain folder (#1020)", () => {
	it("nested and equal folders overlap; siblings and prefixes do not", () => {
		expect(overlaps(at("notes"), at("notes"))).toBe(true);
		expect(overlaps(at("notes"), at("notes", "a"))).toBe(true);
		expect(overlaps(at("notes", "a"), at("notes"))).toBe(true);
		expect(overlaps(at("notes"), at("notes-2"))).toBe(false);
		expect(overlaps(at("a"), at("b"))).toBe(false);
		expect(overlaps(at("notes"), at("notes", "..cache"))).toBe(true);
	});

	it("busy while another live run works in the same or a nested folder", async () => {
		const d = db({ plain: true, url: at("notes") }, [
			{ repository: { url: join(at("notes"), "sub") } },
		]);
		expect(await folderBusy(d as never, "repo-1", "self")).toBe(true);
		expect(d.investigation.findMany).toHaveBeenCalledWith(
			expect.objectContaining({
				where: expect.objectContaining({
					id: { not: "self" },
					repository: { plain: true },
				}),
			}),
		);
	});

	it("free when the other live runs are elsewhere, or the project is not a plain folder", async () => {
		expect(
			await folderBusy(
				db({ plain: true, url: at("notes") }, [
					{ repository: { url: at("other") } },
					{ repository: null },
				]) as never,
				"repo-1",
			),
		).toBe(false);
		const repo = db({ plain: false, url: at("shop") }, [
			{ repository: { url: at("shop") } },
		]);
		expect(await folderBusy(repo as never, "repo-2")).toBe(false);
		expect(repo.investigation.findMany).not.toHaveBeenCalled();
		expect(await folderBusy(db(null, []) as never, "gone")).toBe(false);
	});

	it("the same folder reached through a linked parent is still the same folder", async () => {
		const base = mkdtempSync(join(tmpdir(), "pl-lock-alias-"));
		try {
			mkdirSync(join(base, "real", "notes"), { recursive: true });
			symlinkSync(join(base, "real"), join(base, "alias"), process.platform === "win32" ? "junction" : "dir");
			const d = db({ plain: true, url: join(base, "alias", "notes") }, [
				{ repository: { url: join(base, "real", "notes") } },
			]);
			expect(await folderBusy(d as never, "repo-alias", "self")).toBe(true);
		} finally {
			rmSync(base, { recursive: true, force: true });
		}
	});

	it("while a folder is turning into a repo, no thread starts in it or a folder inside it", async () => {
		const release = holdConversion(at("notes"));
		try {
			expect(await folderBusy(db({ plain: true, url: at("notes", "sub") }, []) as never, "child")).toBe(true);
			expect(await folderBusy(db({ plain: true, url: at("other") }, []) as never, "other")).toBe(false);
		} finally {
			release();
		}
		expect(await folderBusy(db({ plain: true, url: at("notes", "sub") }, []) as never, "child")).toBe(false);
	});

	it("a second request's hold, refused and released, leaves the first request's hold in place", async () => {
		const first = holdConversion(at("notes"));
		const second = holdConversion(at("notes"));
		second();
		second();
		const child = () => folderBusy(db({ plain: true, url: at("notes", "sub") }, []) as never, "child");
		expect(await child()).toBe(true);
		first();
		expect(await child()).toBe(false);
	});

	it("a path the disk names differently only by letter case is not taken as the same path", () => {
		// On a case-sensitive folder, Alias may be a link to alias: only an exact name is no link.
		expect(sameAsDisk("/code/Alias/notes", "/code/alias/notes")).toBe(false);
		expect(sameAsDisk("C:\\code\\Alias\\notes", "C:\\code\\alias\\notes")).toBe(false);
		expect(sameAsDisk("/code/notes", "/code/notes")).toBe(true);
		// A drive letter is not part of any folder's name.
		expect(sameAsDisk("c:\\code\\notes", "C:\\code\\notes")).toBe(true);
	});
});
