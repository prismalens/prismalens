// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Sumit Patel

import { ACCESS_SCOPE } from "@prismalens/auth";
import { THREAD_TREE_DEFAULTS } from "@prismalens/contracts";
import { describe, expect, it, vi } from "vitest";
import { ThreadTreeController } from "./thread-tree.controller.js";

type Handler = (args: { input: unknown; context: { request: unknown } }) => Promise<unknown>;

const device = (scopes: string[]) => ({ operator: { device: { id: "dev-1", scopes } } });
const PHONE = device(["investigate:read", "investigate:operate"]);
const HOST = device(["investigate:read", "investigate:operate", ACCESS_SCOPE]);
/** A run's bearer never reaches the API with an operator session. */
const BEARER = {};

const LINKS = {
	startedBy: null,
	started: [],
	allowance: null,
	chainId: "r",
	limits: { agentsStartThreads: "ask", perStarter: 4, total: 10, turnsPerDay: 200, pairPerDay: 20 },
};
const SELF = { id: "t", title: "t", link: "/threads/t", state: "running", unread: 0 };

function setup() {
	const tree = {
		links: vi.fn(async (id: string) => (id === "gone" ? null : LINKS)),
		self: vi.fn(async () => SELF),
		revokeAllowance: vi.fn(async () => {}),
	};
	const proposals = { apply: vi.fn(async () => ({ state: "applied" })), dismiss: vi.fn(async () => ({ state: "dismissed" })) };
	const settings = { get: vi.fn(async () => THREAD_TREE_DEFAULTS), set: vi.fn(async (s: unknown) => s) };
	const routes = new ThreadTreeController(tree as never, proposals as never, settings as never).routes() as unknown as Record<
		string,
		{ "~orpc": { handler: Handler } }
	>;
	const h = (name: string) => routes[name]?.["~orpc"].handler as Handler;
	return { h, tree, proposals, settings };
}

describe("the agent-started thread routes (#1101 cat 10, 2cc93e1ad)", () => {
	it("serves a thread's start links, and 404 for none", async () => {
		const { h } = setup();
		await expect(h("links")({ input: { id: "t" }, context: { request: PHONE } })).resolves.toEqual(LINKS);
		await expect(h("links")({ input: { id: "gone" }, context: { request: PHONE } })).rejects.toMatchObject({ code: "NOT_FOUND" });
	});

	it("refuses a paired device and a run's bearer on every write that changes what agents run", async () => {
		const { h, proposals, settings, tree } = setup();
		const writes = {
			applyProposal: { id: "t", pid: "p" },
			revokeAllowance: { id: "t" },
			updateSettings: THREAD_TREE_DEFAULTS,
		};
		for (const request of [PHONE, BEARER])
			for (const [name, input] of Object.entries(writes))
				await expect(h(name)({ input, context: { request } })).rejects.toMatchObject({ code: "FORBIDDEN" });
		expect(proposals.apply).not.toHaveBeenCalled();
		expect(settings.set).not.toHaveBeenCalled();
		expect(tree.revokeAllowance).not.toHaveBeenCalled();
	});

	it("lets the host apply, revoke and change the caps; anyone may dismiss or read the settings", async () => {
		const { h, proposals, settings, tree } = setup();
		await h("applyProposal")({ input: { id: "t", pid: "p" }, context: { request: HOST } });
		expect(proposals.apply).toHaveBeenCalledWith("t", "p", "dev-1");
		await h("revokeAllowance")({ input: { id: "t" }, context: { request: HOST } });
		expect(tree.revokeAllowance).toHaveBeenCalledWith("r");
		await h("updateSettings")({ input: { ...THREAD_TREE_DEFAULTS, depth: 3 }, context: { request: HOST } });
		expect(settings.set).toHaveBeenCalledWith({ ...THREAD_TREE_DEFAULTS, depth: 3 });
		await h("dismissProposal")({ input: { id: "t", pid: "p" }, context: { request: PHONE } });
		expect(proposals.dismiss).toHaveBeenCalledWith("t", "p");
		await expect(h("getSettings")({ input: undefined, context: { request: PHONE } })).resolves.toEqual(THREAD_TREE_DEFAULTS);
	});
});
