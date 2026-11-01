// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Sumit Patel

import { describe, expect, it } from "vitest";
import type { AuthenticatedRequestFn } from "../types.js";
import { GitHubDeploymentsSegment } from "./deployments.js";

const SHA = "a".repeat(40);
const WINDOW = {
	since: new Date("2026-10-01T08:30:00Z"),
	until: new Date("2026-10-01T12:00:00Z"),
};

describe("GitHubDeploymentsSegment (#854)", () => {
	it("maps deployments and their latest status to deploy events", async () => {
		const paths: string[] = [];
		const request: AuthenticatedRequestFn = async (_method, path) => {
			paths.push(path);
			if (path.includes("/statuses"))
				return Response.json([
					{
						state: path.includes("/1/") ? "success" : "inactive",
						target_url: "https://app.example/web",
						created_at: "2026-10-01T10:00:00Z",
					},
				]);
			return Response.json([
				{
					id: 1,
					sha: SHA,
					ref: "v1.4.0",
					environment: "production",
					created_at: "2026-10-01T09:59:00Z",
					creator: { login: "octo" },
				},
				{
					id: 2,
					sha: SHA,
					ref: "main",
					environment: "staging",
					created_at: "2026-10-01T09:00:00Z",
					creator: null,
				},
			]);
		};
		const events = await new GitHubDeploymentsSegment().listDeploymentEvents(
			request,
			"acme/web",
			WINDOW,
		);
		expect(paths[0]).toBe("/repos/acme/web/deployments?per_page=100&page=1");
		expect(events).toEqual([
			{
				version: "v1.4.0",
				environment: "production",
				status: "succeeded",
				sha: SHA,
				actor: "octo",
				url: "https://app.example/web",
				at: "2026-10-01T10:00:00Z",
			},
		]);
	});

	it("skips a deploy deleted since the list and keeps the rest; any other status failure throws", async () => {
		const list = [3, 1].map((id) => ({
			id,
			sha: SHA,
			ref: "v1.4.0",
			environment: "production",
			created_at: "2026-10-01T09:59:00Z",
			creator: null,
		}));
		const answering =
			(failed: number): AuthenticatedRequestFn =>
			async (_m, path) => {
				if (!path.includes("/statuses")) return Response.json(list);
				if (path.includes("/3/")) return new Response(null, { status: failed });
				return Response.json([{ state: "success", created_at: "2026-10-01T10:00:00Z" }]);
			};
		const segment = new GitHubDeploymentsSegment();
		const events = await segment.listDeploymentEvents(answering(404), "acme/web", WINDOW);
		expect(events).toHaveLength(1);
		for (const status of [401, 403, 429, 500])
			await expect(
				segment.listDeploymentEvents(answering(status), "acme/web", WINDOW),
			).rejects.toThrow(`HTTP ${status}`);
	});

	it("keeps a superseded deploy by its earlier successful status", async () => {
		const request: AuthenticatedRequestFn = async (_m, path) =>
			path.includes("/statuses")
				? Response.json([
						{ state: "inactive", created_at: "2026-10-01T12:00:00Z" },
						{
							state: "success",
							target_url: "https://app.example/web",
							created_at: "2026-10-01T10:00:00Z",
						},
					])
				: Response.json([
						{
							id: 4,
							sha: SHA,
							ref: "v1.4.0",
							environment: "production",
							created_at: "2026-10-01T09:59:00Z",
							creator: null,
						},
					]);
		const events = await new GitHubDeploymentsSegment().listDeploymentEvents(
			request,
			"acme/web",
			WINDOW,
		);
		expect(events).toEqual([
			{
				version: "v1.4.0",
				environment: "production",
				status: "succeeded",
				sha: SHA,
				actor: null,
				url: "https://app.example/web",
				at: "2026-10-01T10:00:00Z",
			},
		]);
	});

	it("uses the commit when the ref is a branch", async () => {
		const request: AuthenticatedRequestFn = async (_m, path) =>
			path.includes("/statuses")
				? Response.json([{ state: "failure", created_at: "2026-10-01T10:00:00Z" }])
				: Response.json([
						{
							id: 3,
							sha: SHA,
							ref: "main",
							environment: "production",
							created_at: "2026-10-01T09:00:00Z",
							creator: null,
						},
					]);
		const [event] = await new GitHubDeploymentsSegment().listDeploymentEvents(
			request,
			"acme/web",
			WINDOW,
		);
		expect(event).toMatchObject({ version: SHA, status: "failed", url: null });
	});

	it("pages back until the window's start and skips deploys outside it", async () => {
		const pages: string[] = [];
		const at = (h: number) => new Date(Date.UTC(2026, 9, 1, h)).toISOString();
		const deploy = (id: number, created: string) => ({
			id,
			sha: SHA,
			ref: `v1.${id}.0`,
			environment: "production",
			created_at: created,
			creator: null,
		});
		const request: AuthenticatedRequestFn = async (_m, path) => {
			if (path.includes("/statuses"))
				return Response.json([{ state: "success", created_at: at(10) }]);
			pages.push(path);
			if (path.endsWith("page=1"))
				return Response.json(
					Array.from({ length: 100 }, (_, i) => deploy(1000 + i, at(13))),
				);
			return Response.json([deploy(2, at(9)), deploy(3, at(1))]);
		};
		const events = await new GitHubDeploymentsSegment().listDeploymentEvents(
			request,
			"acme/web",
			WINDOW,
		);
		expect(pages).toEqual([
			"/repos/acme/web/deployments?per_page=100&page=1",
			"/repos/acme/web/deployments?per_page=100&page=2",
		]);
		expect(events.map((e) => e.version)).toEqual(["v1.2.0"]);
	});
});
