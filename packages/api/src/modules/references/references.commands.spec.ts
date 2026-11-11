// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Sumit Patel

import { ReferencesService } from "./references.service.js";

const RUN = "6a3b1c2d-4e5f-4a6b-8c7d-9e0f1a2b3c4d";

const CLAUDE_COMMANDS = [
	{ name: "review", description: "Review the diff", inputHint: "  [path]  --strict " },
	{ name: "compact", description: "Clear history but keep a summary", inputHint: "[instructions]" },
	{ name: "model", description: "Set the model" },
	{ name: "login", description: "Sign in" },
	{ name: "logout", description: "Sign out" },
];
const CODEX_COMMANDS = [
	{ name: "init", description: "Create an AGENTS.md file" },
	{ name: "diff", description: "Show the git diff" },
];

function prisma() {
	return {
		investigation: {
			findUnique: vi.fn(async ({ where }: { where: { id: string } }) =>
				where.id === RUN
					? {
							id: RUN,
							incidentId: null,
							repositoryId: null,
							serviceId: null,
							workspace: null,
							harness: "claude-code",
							agentCommands: JSON.stringify(CLAUDE_COMMANDS),
						}
					: null,
			),
			findMany: vi.fn(async () => []),
		},
		investigationEvent: { findMany: vi.fn(async () => []) },
		referenceUse: { findMany: vi.fn(async () => []) },
		setting: {
			findUnique: vi.fn(async ({ where }: { where: { key: string } }) =>
				where.key === "agents.commands.codex" ? { value: JSON.stringify(CODEX_COMMANDS) } : null,
			),
		},
	};
}

const rows = (hits: { ref: { label: string }; source?: string; group?: string }[]) =>
	hits.map((h) => `${h.group} ${h.ref.label}`);

describe("`/` commands (#1024)", () => {
	it("in a thread: app commands, then the agent's under its name; compact once, login and logout never", async () => {
		const svc = new ReferencesService(prisma() as never);
		const { hits } = await svc.search({ q: "", trigger: "/", threadId: RUN, limit: 50 });
		expect(rows(hits).sort()).toEqual(
			[
				"PrismaLens /investigate",
				"PrismaLens /ask",
				"PrismaLens /note",
				"PrismaLens /compact",
				"PrismaLens /new",
				"PrismaLens /model",
				"PrismaLens /effort",
				"PrismaLens /context",
				"Claude Code /review",
				"Claude Code /model",
			].sort(),
		);
	});

	it("a command hit keeps the agent's inputHint exactly as sent", async () => {
		const svc = new ReferencesService(prisma() as never);
		const { hits } = await svc.search({ q: "review", trigger: "/", threadId: RUN, limit: 50 });
		expect(hits.find((h) => h.ref.id === "agent:review")).toMatchObject({
			source: "agent",
			inputHint: "  [path]  --strict ",
		});
	});

	it('a new thread with harness "codex" lists Codex\'s commands from its last run, and no thread-only command', async () => {
		const svc = new ReferencesService(prisma() as never);
		const { hits } = await svc.search({ q: "", trigger: "/", scope: "new:home", harness: "codex", limit: 50 });
		expect(hits.filter((h) => h.source === "agent").map((h) => [h.group, h.ref.label, h.detail])).toEqual([
			["Codex", "/diff", "Show the git diff (from the last run)"],
			["Codex", "/init", "Create an AGENTS.md file (from the last run)"],
		]);
		expect(hits.filter((h) => h.source === "app").map((h) => h.ref.label).sort()).toEqual(
			["/ask", "/effort", "/investigate", "/model", "/note"].sort(),
		);
	});
});
