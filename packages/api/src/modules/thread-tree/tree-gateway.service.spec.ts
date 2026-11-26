// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Sumit Patel

import { THREAD_TREE_DEFAULTS } from "@prismalens/contracts";
import { fail, isFailure } from "@prismalens/integrations/harness";
import { describe, expect, it, vi } from "vitest";
import type { TreePort } from "../gateway/gateway.service.js";
import { TreeGateway } from "./tree-gateway.service.js";

function bound(opts: { root?: string | null; setting?: "ask" | "allow" | "never" } = {}) {
	let port: TreePort | undefined;
	const gateway = { bindTree: (p: TreePort) => (port = p), canRead: vi.fn(async () => true) };
	const tree = {
		links: vi.fn(async () => (opts.root === null ? null : { chainId: opts.root ?? "root" })),
		send: vi.fn(async () => ({ value: "sent" })),
		bindRewind: vi.fn(async (): Promise<unknown> => ({ messageId: "m1", bound: true })),
		canRead: undefined as unknown as (a: string, b: string) => Promise<boolean>,
	};
	const actions = {
		gate: vi.fn(async () => ({ value: "gated" })),
		recorded: vi.fn(async (): Promise<unknown> => null),
	};
	const proposals = { propose: vi.fn(async () => ({ id: "p" })) };
	const settings = { get: async () => ({ ...THREAD_TREE_DEFAULTS, agentsStartThreads: opts.setting ?? "ask" }) };
	new TreeGateway(gateway as never, tree as never, actions as never, proposals as never, settings as never).onModuleInit();
	return { port: port as TreePort, tree, actions, proposals, gateway };
}

describe("the gateway's thread port (#1101 cat 10, 2cc93e1ad)", () => {
	it("sends act calls through the gate keyed by where the caller's chain began, with its requestId", async () => {
		const { port, actions } = bound({ root: "r1" });
		await port.tree.start("run", { requestId: "q1", title: "t", brief: "b", workspace: { kind: "new_from_parent" } } as never);
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
	});

	it("passes messages and proposals through, reads by the gateway's rule, and turns the act tools off on Never", async () => {
		const { port, tree, proposals, gateway } = bound({ setting: "never" });
		expect(await port.actsOff()).toBe(true);
		await port.tree.send("run", { to: "starter" } as never);
		await port.proposals.propose("run", { kind: "project_add", source: "/x" }, "why");
		expect(tree.send).toHaveBeenCalledWith("run", { to: "starter" });
		expect(await tree.canRead("run", "other")).toBe(true);
		expect(gateway.canRead).toHaveBeenCalledWith("run", "other");
		expect(proposals.propose).toHaveBeenCalled();
		expect(await bound({ setting: "ask" }).port.actsOff()).toBe(false);
	});
});

describe("the gateway's rewind tool (#1193)", () => {
	it("answers a retried requestId with its recorded result, without binding a new preview", async () => {
		const { port, tree, actions } = bound({ root: "r1" });
		actions.recorded.mockResolvedValueOnce({ value: { rewound: "first answer" } });
		tree.bindRewind.mockResolvedValueOnce(
			fail("invalid_input", "That thread is running.", "Stop it first with pl_thread_cancel."),
		);
		const r = await port.tree.rewind("run", { requestId: "q1", other: "t2" } as never);
		expect(r).toEqual({ value: { rewound: "first answer" } });
		expect(actions.recorded).toHaveBeenCalledWith("run", "q1");
		expect(tree.bindRewind).not.toHaveBeenCalled();
		expect(actions.gate).not.toHaveBeenCalled();
	});

	it("binds a preview for an unseen requestId and gates the bound call", async () => {
		const { port, tree, actions } = bound({ root: "r1" });
		const r = await port.tree.rewind("run", { requestId: "q2", other: "t2" } as never);
		expect(r).toEqual({ value: "gated" });
		expect(tree.bindRewind).toHaveBeenCalledWith("run", { requestId: "q2", other: "t2" });
		expect(actions.gate).toHaveBeenCalledWith({
			callerId: "run",
			rootId: "r1",
			tool: "pl_thread_rewind",
			args: { messageId: "m1", bound: true },
			requestId: "q2",
		});
	});
});
