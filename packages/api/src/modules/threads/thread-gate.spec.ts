// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Sumit Patel

import { describe, expect, it } from "vitest";
import { tryExclusive, withShared } from "./thread-gate.js";

function deferred() {
	let resolve!: () => void;
	const promise = new Promise<void>((r) => {
		resolve = r;
	});
	return { promise, resolve };
}

/** Small tests run on a fake clock, so a flush drains microtasks rather than waiting on a timer. */
const flush = async () => {
	for (let i = 0; i < 10; i++) await Promise.resolve();
};

describe("thread gate (#1193)", () => {
	it("a shared holder woken by an exclusive release keeps a new exclusive out while its work runs", async () => {
		const release = tryExclusive("t-woken");
		expect(release).toBeTypeOf("function");
		const work = deferred();
		const log: string[] = [];
		const shared = withShared("t-woken", async () => {
			log.push("shared started");
			await work.promise;
		});
		await flush();
		expect(log).toEqual([]);

		release?.();
		await flush();
		expect(log).toEqual(["shared started"]);
		expect(tryExclusive("t-woken")).toBeNull();

		work.resolve();
		await shared;
	});

	it("a shared holder that joined beside a woken one still keeps an exclusive out after the woken one ends", async () => {
		const release = tryExclusive("t-beside");
		const woken = deferred();
		const wokenRun = withShared("t-beside", () => woken.promise);
		await flush();
		release?.();
		await flush();
		const beside = deferred();
		const besideRun = withShared("t-beside", () => beside.promise);
		await flush();

		woken.resolve();
		await wokenRun;
		expect(tryExclusive("t-beside")).toBeNull();

		beside.resolve();
		await besideRun;
	});

	it("an exclusive held after a woken shared holder ends still makes the next shared caller wait", async () => {
		const first = tryExclusive("t-after");
		const work = deferred();
		const shared = withShared("t-after", () => work.promise);
		await flush();
		first?.();
		await flush();
		work.resolve();
		await shared;

		const second = tryExclusive("t-after");
		expect(second).toBeTypeOf("function");
		const log: string[] = [];
		const next = withShared("t-after", async () => {
			log.push("next started");
		});
		await flush();
		expect(log).toEqual([]);

		second?.();
		await next;
		expect(log).toEqual(["next started"]);
	});
});
