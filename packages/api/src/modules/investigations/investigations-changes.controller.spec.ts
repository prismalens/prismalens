// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Sumit Patel

/**
 * GET /investigations/:id/changes reads the live diff of the workspace the
 * server recorded for the run, never a path from the request (#1020).
 */
import { Test, type TestingModule } from "@nestjs/testing";
import { telemetryStub } from "../../../test/factories/index.js";
import { HarnessService } from "../../core/harness/harness.service.js";
import { TelemetryService } from "../../core/telemetry/telemetry.service.js";
import { MutationThrottleGuard } from "../../core/throttle/mutation-throttle.guard.js";
import { DispatchService } from "../../infrastructure/dispatch/dispatch.service.js";
import { AttachmentsService } from "./attachments.service.js";
import { InvestigationsController } from "./investigations.controller.js";
import { InvestigationsService } from "./investigations.service.js";
import { readWorktreeChanges } from "./worktree-changes.js";

vi.mock("./worktree-changes.js", () => ({
	readWorktreeChanges: vi.fn(async () => ({ repos: [] })),
}));

const findById = vi.fn();
const WORKSPACE = {
	layout: "single",
	cwd: "/runs/r1/repo",
	repos: [
		{
			name: "repo",
			dir: "/runs/r1/repo",
			sourceKind: "folder",
			url: "/src/shop",
			subPath: null,
			connectionId: null,
			head: "a".repeat(40),
			branch: "prismalens/shop-r1",
			services: [],
		},
	],
};

describe("InvestigationsController.getChanges (#1020)", () => {
	let controller: InvestigationsController;

	beforeEach(async () => {
		vi.clearAllMocks();
		const module: TestingModule = await Test.createTestingModule({
			controllers: [InvestigationsController],
			providers: [
				{ provide: InvestigationsService, useValue: { findById } },
				{ provide: DispatchService, useValue: {} },
				{ provide: TelemetryService, useValue: telemetryStub() },
				{ provide: AttachmentsService, useValue: {} },
				{ provide: HarnessService, useValue: { launchProbe: () => ({}) } },
			],
		})
			.overrideGuard(MutationThrottleGuard)
			.useValue({ canActivate: () => true })
			.compile();
		controller = module.get(InvestigationsController);
	});

	function getChanges(): (args: {
		input: { id: string; workspace?: unknown };
	}) => Promise<unknown> {
		// biome-ignore lint/suspicious/noExplicitAny: procedure map is loosely typed.
		const procs = controller.investigations() as Record<string, any>;
		return procs.getChanges["~orpc"].handler;
	}

	it("diffs the workspace stored on the run", async () => {
		findById.mockResolvedValue({ id: "r1", workspace: JSON.stringify(WORKSPACE) });
		const result = await getChanges()({
			input: { id: "r1", workspace: { cwd: "/etc" } },
		});
		expect(result).toEqual({ repos: [] });
		expect(readWorktreeChanges).toHaveBeenCalledWith(WORKSPACE);
	});

	it("passes no workspace when the stored one is missing or malformed", async () => {
		findById.mockResolvedValue({ id: "r1", workspace: "{not json" });
		await getChanges()({ input: { id: "r1" } });
		expect(readWorktreeChanges).toHaveBeenLastCalledWith(null);
		findById.mockResolvedValue({ id: "r1", workspace: null });
		await getChanges()({ input: { id: "r1" } });
		expect(readWorktreeChanges).toHaveBeenLastCalledWith(null);
	});

	it("names a legacy repo the way every other route does, never by its credential-bearing address", async () => {
		const legacy = {
			...WORKSPACE,
			repos: [
				{
					...WORKSPACE.repos[0],
					sourceKind: "url",
					url: "https://bob:s3cret@git.example/acme/shop.git",
					name: "bob:s3cret@git.example-acme-shop",
					dir: "/runs/r1/bob:s3cret@git.example-acme-shop",
				},
			],
		};
		findById.mockResolvedValue({ id: "r1", workspace: JSON.stringify(legacy) });
		vi.mocked(readWorktreeChanges).mockResolvedValueOnce({
			repos: [
				{
					state: "unavailable",
					repo: legacy.repos[0]?.name ?? "",
					reason: "removed",
				},
			],
		});
		const result = await getChanges()({ input: { id: "r1" } });
		expect(result).toEqual({
			repos: [{ state: "unavailable", repo: "repo-1", reason: "removed" }],
		});
		expect(JSON.stringify(result)).not.toContain("s3cret");
	});

	it("refuses an unknown run", async () => {
		findById.mockResolvedValue(null);
		await expect(getChanges()({ input: { id: "nope" } })).rejects.toMatchObject(
			{ code: "NOT_FOUND" },
		);
		expect(readWorktreeChanges).not.toHaveBeenCalled();
	});
});
