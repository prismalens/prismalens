// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Sumit Patel

import { describe, expect, it } from "vitest";
import { shownWorkspace } from "../investigations/investigations.controller.js";
import { shownMetadata, TimelineController } from "./timeline.controller.js";

const SENTINEL = "ghp_SENTINEL938";

describe("a run's recorded repositories as answered (#938)", () => {
	it("an investigation_started entry written before #938 loses userinfo and query", () => {
		const meta = shownMetadata("investigation_started", {
			repo: `https://x:${SENTINEL}@github.com/acme/api`,
			repos: [
				{ name: "api", url: `https://x:${SENTINEL}@github.com/acme/api`, head: "abc" },
				{ name: "web", url: `git@github.com:acme/web.git?token=${SENTINEL}`, head: "def" },
				{ name: "local", url: "/srv/code/local", head: "123" },
			],
		});
		expect(JSON.stringify(meta)).not.toContain(SENTINEL);
		expect(meta).toMatchObject({
			repo: "https://github.com/acme/api",
			repos: [
				{ url: "https://github.com/acme/api" },
				{ url: "git@github.com:acme/web.git" },
				{ url: "/srv/code/local" },
			],
		});
	});

	it("a whole pre-#938 row through the serializer keeps no credential, description included", () => {
		const controller = new TimelineController({} as never);
		const out = (controller as unknown as { serializeTimelineEntry(e: unknown): unknown }).serializeTimelineEntry({
			id: "t1",
			type: "investigation_started",
			description: `Investigating a snapshot of URL https://u:${SENTINEL}@github.com/x/y at main abc.`,
			metadata: JSON.stringify({ repo: `https://u:${SENTINEL}@github.com/x/y` }),
			occurredAt: new Date("2026-10-01T00:00:00Z"),
		});
		expect(JSON.stringify(out)).not.toContain(SENTINEL);
		expect(JSON.stringify(out)).toContain("https://github.com/x/y");
	});

	it("a pre-#938 run's folder name for a nested address is not returned", () => {
		const ws = {
			layout: "multi" as const,
			cwd: "/runs/r1",
			repos: [
				{
					name: `u_${SENTINEL}_other`,
					dir: `/runs/r1/u_${SENTINEL}_other`,
					sourceKind: "url" as const,
					url: `https://github.com/https://u:${SENTINEL}@other`,
					subPath: null,
					connectionId: null,
					head: "abc123def456",
					branch: "main",
					services: ["api"],
				},
			],
		};
		expect(JSON.stringify(shownWorkspace(ws as never))).not.toContain(SENTINEL);
		const meta = shownMetadata("investigation_started", {
			repos: [{ name: `u_${SENTINEL}_other`, url: `https://github.com/https://u:${SENTINEL}@other`, head: "abc" }],
		});
		expect(JSON.stringify(meta)).not.toContain(SENTINEL);
	});

	it("other entries are left alone", () => {
		const meta = { repo: "acme/api" };
		expect(shownMetadata("status_changed", meta)).toBe(meta);
	});

	it("a workspace answer loses userinfo and query; the row is untouched", () => {
		const ws = {
			layout: "single" as const,
			cwd: "/runs/r1/repo",
			repos: [
				{
					name: "repo",
					dir: "/runs/r1/repo",
					sourceKind: "url" as const,
					url: `https://x:${SENTINEL}@github.com/acme/api`,
					subPath: null,
					connectionId: null,
					head: "abc123def456",
					branch: "main",
					services: ["api"],
				},
			],
		};
		const shown = shownWorkspace(ws as never);
		expect(JSON.stringify(shown)).not.toContain(SENTINEL);
		expect(ws.repos[0]?.url).toContain(SENTINEL);
	});
});
