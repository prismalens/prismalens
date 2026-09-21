// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Sumit Patel

import { describe, expect, it, vi } from "vitest";
import { telemetryStub } from "../../../test/factories/index.js";
import type { DispatchService } from "../../infrastructure/dispatch/dispatch.service.js";
import type { GitHubCommentService } from "../delivery/github-comment.service.js";
import { InvestigationsController } from "./investigations.controller.js";
import type { InvestigationsService } from "./investigations.service.js";

describe("InvestigationsController.postToGitHub (#606)", () => {
	it("delegates to GitHubCommentService.post", async () => {
		const mockGitHubComment = {
			post: vi.fn(async (id: string, target: string) => ({
				commentUrl: "https://github.com/prismalens/prismalens/issues/1#issuecomment-10",
			})),
		};

		const controller = new InvestigationsController(
			{} as unknown as InvestigationsService,
			{} as unknown as DispatchService,
			telemetryStub(),
			mockGitHubComment as unknown as GitHubCommentService,
		);

		const procs = controller.investigations() as unknown as Record<
			string,
			{ "~orpc": { handler: (a: { input: { id: string; target: string } }) => Promise<{ commentUrl: string }> } }
		>;

		const result = await procs.postToGitHub["~orpc"].handler({
			input: {
				id: "123e4567-e89b-12d3-a456-426614174000",
				target: "https://github.com/prismalens/prismalens/issues/1",
			},
		});

		expect(result).toEqual({
			commentUrl: "https://github.com/prismalens/prismalens/issues/1#issuecomment-10",
		});
		expect(mockGitHubComment.post).toHaveBeenCalledWith(
			"123e4567-e89b-12d3-a456-426614174000",
			"https://github.com/prismalens/prismalens/issues/1",
		);
	});
});
