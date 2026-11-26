// @vitest-environment happy-dom
// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Sumit Patel

import { act, createElement, useEffect } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, describe, expect, it } from "vitest";
import {
	type AttentionToast,
	openAttentionToast,
	setAttentionToasts,
	useAttentionToastOwner,
} from "./attention-toasts";

(
	globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }
).IS_REACT_ACT_ENVIRONMENT = true;

const toastFor = (id: string): AttentionToast => ({
	id,
	title: id,
	body: "",
	threadId: `t-${id}`,
	tone: "neutral",
	urgency: 0,
});

const read = () => {
	let now: readonly AttentionToast[] = [];
	setAttentionToasts((all) => {
		now = all;
		return all;
	});
	return now.map((t) => t.id);
};

/** The runtime's part that owns toasts: raises `id` once, opening with `open`. */
function Owner({ id, open }: { id: string; open: (t: string) => void }) {
	const raise = useAttentionToastOwner((threadId) => open(threadId));
	useEffect(() => raise(id, (all) => [...all, toastFor(id)]), [raise, id]);
	return null;
}

const roots: Root[] = [];
const mount = async (id: string, open: (t: string) => void) => {
	const root = createRoot(document.createElement("div"));
	roots.push(root);
	await act(async () => root.render(createElement(Owner, { id, open })));
	return root;
};

afterEach(async () => {
	for (const r of roots.splice(1)) await act(async () => r.unmount());
	roots.length = 0;
	setAttentionToasts(() => []);
});

describe("attention toasts and the runtime that raises them", () => {
	it("keep through a new opener (a navigate change), go with their runtime's unmount, and a later runtime's toast opens through it", async () => {
		const opened: string[] = [];
		const first = await mount("a", (t) => opened.push(`first ${t}`));
		await act(async () =>
			first.render(
				createElement(Owner, {
					id: "a",
					open: (t) => opened.push(`first again ${t}`),
				}),
			),
		);
		const afterNewOpener = read();
		await act(async () => first.unmount());
		const afterUnmount = read();
		await mount("b", (t) => opened.push(`second ${t}`));
		const afterRemount = read();
		openAttentionToast(toastFor("b"));

		expect([
			afterNewOpener,
			afterUnmount,
			afterRemount,
			opened,
			read(),
		]).toEqual([["a"], [], ["b"], ["second t-b"], []]);
	});
});
