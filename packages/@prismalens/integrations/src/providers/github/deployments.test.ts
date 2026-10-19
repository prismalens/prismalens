// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Sumit Patel

import { describe, expect, it } from "vitest";
import type { AuthenticatedRequestFn } from "../types.js";
import { GitHubDeploymentsSegment } from "./deployments.js";

const SHA = "a".repeat(40);

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
		);
		expect(paths[0]).toBe("/repos/acme/web/deployments?per_page=30");
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
		);
		expect(event).toMatchObject({ version: SHA, status: "failed", url: null });
	});
});
