// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Sumit Patel

import { describe, expect, it, vi } from "vitest";
import type { PrismaService } from "../prisma/prisma.service.js";
import { AgentUpdatesService } from "./agent-updates.service.js";

const DAY = 24 * 60 * 60 * 1000;

/** A Setting table of two rows: About's update prefs and the stored agent releases. */
function prismaWith(rows: Record<string, unknown>) {
	const upsert = vi.fn(
		async (a: { where: { key: string }; update: { value: string } }) => {
			rows[a.where.key] = JSON.parse(a.update.value);
		},
	);
	const prisma = {
		setting: {
			findUnique: async ({ where }: { where: { key: string } }) =>
				where.key in rows
					? { key: where.key, value: JSON.stringify(rows[where.key]) }
					: null,
			upsert,
		},
	} as unknown as PrismaService;
	return { prisma, upsert };
}

function service(rows: Record<string, unknown>, platform: NodeJS.Platform) {
	const { prisma, upsert } = prismaWith(rows);
	const svc = new AgentUpdatesService(prisma);
	svc.platform = platform;
	svc.env = { PATH: "" };
	svc.now = () => 10 * DAY;
	svc.realPath = (p) => p;
	svc.run = async (cmd) =>
		cmd === "npm" ? "C:\\Users\\o\\AppData\\Roaming\\npm" : null;
	const urls: string[] = [];
	svc.fetchImpl = (async (url: string | URL | Request) => {
		urls.push(String(url));
		return new Response(JSON.stringify({ version: "0.200.0" }));
	}) as typeof fetch;
	return { svc, urls, upsert };
}

const npmCodex = {
	binaryPaths: { codex: "C:\\Users\\o\\AppData\\Roaming\\npm\\codex.cmd" },
};

describe("AgentUpdatesService.commandsFor (#1180)", () => {
	it("an npm codex install: the npm update, its newer release, sign-out and change account", async () => {
		const { svc } = service({}, "win32");
		const lines = await svc.commandsFor("codex", npmCodex, "0.171.0", {
			"@openai/codex": { checkedAt: 0, latest: "0.180.0" },
		});
		expect(lines).toEqual({
			update: { command: "npm i -g @openai/codex@latest" },
			newerRelease: "0.180.0",
			signOut: {
				command: "& 'C:\\Users\\o\\AppData\\Roaming\\npm\\codex.cmd' logout",
			},
			switchAccount: {
				command: "& 'C:\\Users\\o\\AppData\\Roaming\\npm\\codex.cmd' login",
			},
		});
	});

	it("a stored CODEX_HOME stages no sign-out or change account, as Sign in", async () => {
		const { svc } = service({}, "win32");
		const lines = await svc.commandsFor(
			"codex",
			{ ...npmCodex, envNames: { codex: ["codex_home"] } },
			"0.171.0",
			{},
		);
		expect([lines.signOut, lines.switchAccount, lines.newerRelease]).toEqual([
			null,
			null,
			null,
		]);
	});

	it("a Codex install outside npm and Homebrew runs codex update, with no newer release", async () => {
		const { svc } = service({}, "linux");
		svc.run = async (cmd) => (cmd === "npm" ? "/usr/local" : "/opt/homebrew");
		const lines = await svc.commandsFor(
			"codex",
			{ binaryPaths: { codex: "/home/o/bin/codex" } },
			"0.171.0",
			{ "@openai/codex": { checkedAt: 0, latest: "0.180.0" } },
		);
		expect(lines.update).toEqual({ command: "/home/o/bin/codex update" });
		expect(lines.newerRelease).toBeNull();
	});
});

describe("AgentUpdatesService.releases (#1180)", () => {
	it("Check for updates off: no npm fetch and nothing stored", async () => {
		const { svc, urls, upsert } = service(
			{ "update.prefs": { checkForUpdates: false } },
			"linux",
		);
		expect(await svc.releases(["codex"])).toEqual({});
		await svc.settled();
		expect(urls).toEqual([]);
		expect(upsert).not.toHaveBeenCalled();
	});

	it("on: reads the installed npm agents' latest once and stores it", async () => {
		const rows: Record<string, unknown> = {};
		const { svc, urls } = service(rows, "linux");
		await svc.releases(["codex", "gemini"]);
		await svc.settled();
		expect(urls).toEqual([
			"https://registry.npmjs.org/@openai/codex/latest",
			"https://registry.npmjs.org/@google/gemini-cli/latest",
		]);
		expect(rows.AGENT_RELEASES).toEqual({
			"@openai/codex": { checkedAt: 10 * DAY, latest: "0.200.0" },
			"@google/gemini-cli": { checkedAt: 10 * DAY, latest: "0.200.0" },
		});
		await svc.releases(["codex", "gemini"]);
		await svc.settled();
		expect(urls).toHaveLength(2);
	});
});
