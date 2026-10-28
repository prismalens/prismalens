// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Sumit Patel

import { beforeEach, describe, expect, it, vi } from "vitest";
import { createTerminalStore, type TerminalStore } from "./store";

let store: TerminalStore;
beforeEach(() => {
	store = createTerminalStore();
});

describe("terminal store", () => {
	it("has no panel until the layout mounts one", () => {
		expect(store.get().hosts).toBe(0);
		const release = store.registerHost();
		expect(store.get().hosts).toBe(1);
		release();
		expect(store.get().hosts).toBe(0);
	});

	it("names tabs after the shell and keeps one active", () => {
		const a = store.newTab();
		const b = store.newTab();
		expect(store.get().tabs.map((t) => t.title)).toEqual(["Terminal", "Terminal 2"]);
		expect(store.get().active).toBe(b);
		store.closeTab(b);
		expect(store.get().active).toBe(a);
	});

	it("stages a command in the active shell and asks the layout to open", () => {
		const open = vi.fn();
		store.onOpenRequest(open);
		const id = store.newTab();
		store.stage("pl doctor");
		expect(store.get().tabs.find((t) => t.id === id)?.draft).toBe("pl doctor");
		expect(open).toHaveBeenCalledTimes(1);
	});

	it("stages in a new shell when there is none, or the active one has exited", () => {
		store.stage("ls");
		expect(store.get().tabs).toHaveLength(1);
		const first = store.get().active as number;
		store.markExited(first, 0);
		store.stage("pwd");
		expect(store.get().tabs).toHaveLength(2);
		expect(store.get().tabs[1].draft).toBe("pwd");
	});

	it("never stages text with control characters", () => {
		store.stage("ls\u000f");
		expect(store.get().tabs).toHaveLength(0);
	});

	it("sends a confirmed draft as a run frame and clears it", () => {
		const id = store.newTab();
		const send = vi.fn(() => true);
		store.attachSender(id, send);
		store.setDraft(id, "pl doctor");
		store.runDraft(id);
		expect(send).toHaveBeenCalledWith({ t: "run", d: "pl doctor" });
		expect(store.get().tabs[0].draft).toBe("");
	});

	it("keeps the draft when the shell's socket is not open yet", () => {
		const id = store.newTab();
		store.attachSender(id, () => false);
		store.setDraft(id, "pl doctor");
		store.runDraft(id);
		expect(store.get().tabs[0].draft).toBe("pl doctor");
	});

	it("keeps a draft that gained control characters while edited", () => {
		const id = store.newTab();
		const send = vi.fn(() => true);
		store.attachSender(id, send);
		store.setDraft(id, "ls\u001b[201~");
		store.runDraft(id);
		expect(send).not.toHaveBeenCalled();
	});
});
