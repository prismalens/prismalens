// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Sumit Patel

import { THREAD_TREE_DEFAULTS } from "@prismalens/contracts";
import { isFailure } from "@prismalens/integrations/harness";
import { describe, expect, it, vi } from "vitest";
import type { TreePort } from "../gateway/gateway.service.js";
import { TreeGateway } from "./tree-gateway.service.js";

function bound(opts: { root?: string | null; setting?: "ask" | "allow" | "never" } = {}) {
	let port: TreePort | undefined;
	const gateway = { bindTree: (p: TreePort) => (port = p) };
	const tree = {
		tree: vi.fn(async () => (opts.root === null ? null : { rootId: opts.root ?? "root" })),
		send: vi.fn(async () => ({ value: "sent" })),
		wait: vi.fn(async () => ({ value: "waiting" })),
		roster: vi.fn(async (id: string) => (id === "gone" ? null : { members: [] })),
	};
	const actions = { gate: vi.fn(async () => ({ value: "gated" })) };
	const proposals = { propose: vi.fn(async () => ({ id: "p" })) };
	const settings = { get: async () => ({ ...THREAD_TREE_DEFAULTS, agentsStartThreads: opts.setting ?? "ask" }) };
	new TreeGateway(gateway as never, tree as never, actions as never, proposals as never, settings as never).onModuleInit();
	return { port: port as TreePort, tree, actions, proposals };
}

describe("the gateway's tree port (#1024 spec F)", () => {
	it("sends act calls through the gate with the caller's tree root and requestId", async () => {
		const { port, actions } = bound({ root: "r1" });
		await port.tree.start("run", { requestId: "q1", title: "t", role: "db", brief: "b", workspace: { kind: "new_from_parent" } } as never);
		expect(actions.gate).toHaveBeenCalledWith(expect.objectContaining({ callerId: "run", rootId: "r1", tool: "pl_thread_start", requestId: "q1" }));
		await port.tree.cancel("run", "db", "dup", "q2");
		expect(actions.gate).toHaveBeenLastCalledWith(
			expect.objectContaining({ tool: "pl_thread_cancel", args: { id: "db", reason: "dup", requestId: "q2" } }),
		);
	});

	it("answers run_ended for a thread that is gone", async () => {
		const { port } = bound({ root: null });
		const r = await port.tree.start("run", { requestId: "q" } as never);
		expect(isFailure(r) && r.failure.error).toBe("run_ended");
		expect(isFailure(await port.tree.cancel("run", "x", "y", "z"))).toBe(true);
		expect(isFailure(await port.tree.roster("gone"))).toBe(true);
	});

	it("passes reads, messages and proposals through, and turns the act tools off on Never", async () => {
		const { port, tree, proposals } = bound({ setting: "never" });
		expect(await port.actsOff()).toBe(true);
		await port.tree.send("run", { to: "db" } as never);
		await port.tree.wait("run", ["db"], "all");
		expect(await port.tree.roster("run")).toEqual({ value: { members: [] } });
		await port.proposals.propose("run", { kind: "project_add", source: "/x" }, "why");
		expect(tree.send).toHaveBeenCalled();
		expect(tree.wait).toHaveBeenCalledWith("run", ["db"], "all");
		expect(proposals.propose).toHaveBeenCalled();
		expect(await bound({ setting: "ask" }).port.actsOff()).toBe(false);
	});
});
