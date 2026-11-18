// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Sumit Patel

import { describe, expect, it } from "vitest";
import {
	PROJECT_SCRIPT_COMMAND_MAX,
	PROJECT_SCRIPT_NAME_MAX,
	PROJECT_SCRIPTS_MAX,
} from "./project-script-values.js";
import {
	AddProjectScriptSchema,
	ProjectScriptInputSchema,
	RemoveProjectScriptSchema,
	UpdateProjectScriptSchema,
} from "./repository.js";
import {
	ProjectScriptSchema,
	ProjectScriptsSchema,
	ThreadContextSchema,
} from "./thread-context.js";

const VALID_UUID = "11111111-1111-4111-8111-111111111111";
const SCRIPT_UUID = "22222222-2222-4222-8222-222222222222";

describe("project-script-values limits", () => {
	it("exports standard limits", () => {
		expect(PROJECT_SCRIPTS_MAX).toBe(50);
		expect(PROJECT_SCRIPT_NAME_MAX).toBe(60);
		expect(PROJECT_SCRIPT_COMMAND_MAX).toBe(1000);
	});
});

describe("repository schemas: ProjectScriptInputSchema (#1176)", () => {
	it("accepts valid names and commands at the limits", () => {
		const validAtLimits = {
			name: "a".repeat(PROJECT_SCRIPT_NAME_MAX),
			command: "b".repeat(PROJECT_SCRIPT_COMMAND_MAX),
		};
		const res = ProjectScriptInputSchema.safeParse(validAtLimits);
		expect(res.success).toBe(true);
		if (res.success) {
			expect(res.data.name).toBe("a".repeat(PROJECT_SCRIPT_NAME_MAX));
			expect(res.data.command).toBe("b".repeat(PROJECT_SCRIPT_COMMAND_MAX));
		}
	});

	it("trims whitespace from name", () => {
		const res = ProjectScriptInputSchema.safeParse({
			name: "  test:build  ",
			command: "pnpm build",
		});
		expect(res.success).toBe(true);
		if (res.success) {
			expect(res.data.name).toBe("test:build");
		}
	});

	it("rejects empty name or whitespace-only name", () => {
		expect(
			ProjectScriptInputSchema.safeParse({ name: "", command: "pnpm test" })
				.success,
		).toBe(false);
		expect(
			ProjectScriptInputSchema.safeParse({ name: "   ", command: "pnpm test" })
				.success,
		).toBe(false);
	});

	it("rejects name longer than PROJECT_SCRIPT_NAME_MAX", () => {
		expect(
			ProjectScriptInputSchema.safeParse({
				name: "a".repeat(PROJECT_SCRIPT_NAME_MAX + 1),
				command: "pnpm test",
			}).success,
		).toBe(false);
	});

	it("rejects empty or whitespace-only command", () => {
		expect(
			ProjectScriptInputSchema.safeParse({ name: "build", command: "" })
				.success,
		).toBe(false);
		expect(
			ProjectScriptInputSchema.safeParse({ name: "build", command: "   " })
				.success,
		).toBe(false);
	});

	it("rejects command longer than PROJECT_SCRIPT_COMMAND_MAX", () => {
		expect(
			ProjectScriptInputSchema.safeParse({
				name: "build",
				command: "a".repeat(PROJECT_SCRIPT_COMMAND_MAX + 1),
			}).success,
		).toBe(false);
	});

	it("rejects control characters in command", () => {
		// Newline, tab, carriage return, bell, null
		expect(
			ProjectScriptInputSchema.safeParse({
				name: "build",
				command: "echo 1\necho 2",
			}).success,
		).toBe(false);
		expect(
			ProjectScriptInputSchema.safeParse({
				name: "build",
				command: "echo\t1",
			}).success,
		).toBe(false);
		expect(
			ProjectScriptInputSchema.safeParse({
				name: "build",
				command: "echo 1\r",
			}).success,
		).toBe(false);
		expect(
			ProjectScriptInputSchema.safeParse({
				name: "build",
				command: "echo \u0007",
			}).success,
		).toBe(false);
		expect(
			ProjectScriptInputSchema.safeParse({
				name: "build",
				command: "echo \u0000",
			}).success,
		).toBe(false);
	});
});

describe("repository schemas: script action routes input schemas (#1176)", () => {
	it("AddProjectScriptSchema requires valid uuid and script input", () => {
		expect(
			AddProjectScriptSchema.safeParse({
				id: VALID_UUID,
				name: "seed",
				command: "pnpm db:seed",
			}).success,
		).toBe(true);

		expect(
			AddProjectScriptSchema.safeParse({
				id: "not-a-uuid",
				name: "seed",
				command: "pnpm db:seed",
			}).success,
		).toBe(false);
	});

	it("UpdateProjectScriptSchema requires id and scriptId uuids and script input", () => {
		expect(
			UpdateProjectScriptSchema.safeParse({
				id: VALID_UUID,
				scriptId: SCRIPT_UUID,
				name: "seed:fresh",
				command: "pnpm db:seed --fresh",
			}).success,
		).toBe(true);

		expect(
			UpdateProjectScriptSchema.safeParse({
				id: VALID_UUID,
				scriptId: "bad-uuid",
				name: "seed",
				command: "pnpm db:seed",
			}).success,
		).toBe(false);
	});

	it("RemoveProjectScriptSchema requires valid id and scriptId", () => {
		expect(
			RemoveProjectScriptSchema.safeParse({
				id: VALID_UUID,
				scriptId: SCRIPT_UUID,
			}).success,
		).toBe(true);

		expect(
			RemoveProjectScriptSchema.safeParse({
				id: VALID_UUID,
				scriptId: "invalid",
			}).success,
		).toBe(false);
	});
});

describe("thread-context schemas: ProjectScriptSchema & ProjectScriptsSchema (#1176)", () => {
	it("accepts custom runner and optional id on ProjectScriptSchema", () => {
		const parsed = ProjectScriptSchema.safeParse({
			runner: "custom",
			id: SCRIPT_UUID,
			name: "lint:fix",
			command: "biome check --write",
		});
		expect(parsed.success).toBe(true);
		if (parsed.success) {
			expect(parsed.data.runner).toBe("custom");
			expect(parsed.data.id).toBe(SCRIPT_UUID);
		}
	});

	it("accepts detected runners without id", () => {
		const parsed = ProjectScriptSchema.safeParse({
			runner: "pnpm",
			name: "test",
			command: "pnpm run test",
		});
		expect(parsed.success).toBe(true);
		if (parsed.success) {
			expect(parsed.data.runner).toBe("pnpm");
			expect(parsed.data.id).toBeUndefined();
		}
	});

	it("rejects unknown runner", () => {
		expect(
			ProjectScriptSchema.safeParse({
				runner: "cargo",
				name: "test",
				command: "cargo test",
			}).success,
		).toBe(false);
	});

	it("ProjectScriptsSchema parses script arrays", () => {
		const parsed = ProjectScriptsSchema.safeParse({
			scripts: [
				{ runner: "custom", id: SCRIPT_UUID, name: "lint", command: "biome lint" },
				{ runner: "make", name: "build", command: "make build" },
			],
		});
		expect(parsed.success).toBe(true);
		if (parsed.success) {
			expect(parsed.data.scripts).toHaveLength(2);
		}
	});
});

describe("thread-context schemas: tip, detached, pushable, suggestedBranch, machine.isOwner (#1176)", () => {
	const baseThread = {
		threadId: "t1",
		title: "Investigate crash",
		machine: { hostName: "workstation", os: "linux" as const, isHost: true, isOwner: true },
		agent: { harness: "claude-code", model: "opus", effort: "high" },
		workspace: {
			layout: "single" as const,
			cwd: "/work/repo",
			repos: [
				{
					name: "core",
					branch: null,
					head: "a1b2c3d4e5f6",
					additions: 10,
					deletions: 2,
					tip: "a1b2c3d4e5f6",
					detached: true,
					pushable: true,
				},
			],
			kept: [],
			suggestedBranch: "prismalens/investigate-crash-t12345",
		},
		lineage: [],
		plan: null,
		pullRequests: [],
	};

	it("accepts live worktree fields on ContextRepoSchema and workspace", () => {
		const parsed = ThreadContextSchema.safeParse({
			kind: "project",
			...baseThread,
			project: { id: "p1", name: "acme/core" },
			scripts: [],
		});
		expect(parsed.success).toBe(true);
		if (parsed.success && parsed.data.kind === "project") {
			expect(parsed.data.machine.isOwner).toBe(true);
			const repo = parsed.data.workspace?.repos[0];
			expect(repo?.tip).toBe("a1b2c3d4e5f6");
			expect(repo?.detached).toBe(true);
			expect(repo?.pushable).toBe(true);
			expect(parsed.data.workspace?.suggestedBranch).toBe(
				"prismalens/investigate-crash-t12345",
			);
		}
	});

	it("accepts when tip, detached, pushable, suggestedBranch are omitted", () => {
		const parsed = ThreadContextSchema.safeParse({
			kind: "none",
			...baseThread,
			machine: { hostName: "box", os: "macos" as const, isHost: false },
			workspace: {
				layout: "folder" as const,
				cwd: "/folder",
				repos: [
					{
						name: "folder",
						branch: "main",
						head: "f1e2d3",
						additions: null,
						deletions: null,
					},
				],
				kept: [],
			},
			helperPlace: "alerts",
		});
		expect(parsed.success).toBe(true);
		if (parsed.success && parsed.data.kind === "none") {
			expect(parsed.data.machine.isOwner).toBeUndefined();
			expect(parsed.data.workspace?.repos[0]?.tip).toBeUndefined();
			expect(parsed.data.workspace?.repos[0]?.detached).toBeUndefined();
			expect(parsed.data.workspace?.repos[0]?.pushable).toBeUndefined();
			expect(parsed.data.workspace?.suggestedBranch).toBeUndefined();
		}
	});
});
