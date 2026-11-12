// @vitest-environment happy-dom
// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Sumit Patel

import { beforeEach, describe, expect, it, vi } from "vitest";
import {
	draftFileBytes,
	keepSentFiles,
	sentFileBytes,
} from "./draft-store";

const idbStore = new Map<string, unknown>();

vi.mock("idb-keyval", () => ({
	createStore: () => "mock-store",
	get: vi.fn(async (key: string) => idbStore.get(key)),
	set: vi.fn(async (key: string, val: unknown) => {
		idbStore.set(key, val);
	}),
	del: vi.fn(async (key: string) => {
		idbStore.delete(key);
	}),
	keys: vi.fn(async () => Array.from(idbStore.keys())),
}));

describe("draft-store file operations (#1101)", () => {
	beforeEach(() => {
		idbStore.clear();
		vi.restoreAllMocks();
	});

	it("draftFileBytes returns File on success, null without id, and null on 404", async () => {
		const fileBlob = new Blob(["test attachment bytes"], { type: "text/plain" });
		const fetchMock = vi.fn().mockResolvedValue(new Response(fileBlob, { status: 200 }));
		vi.stubGlobal("fetch", fetchMock);

		const file = await draftFileBytes("new:home", {
			id: "att-123",
			name: "notes.txt",
			type: "text/plain",
		});

		expect(fetchMock).toHaveBeenCalledWith(
			"/api/drafts/new%3Ahome/attachments/att-123",
			{ credentials: "include" },
		);
		expect(file?.name).toBe("notes.txt");
		expect(file?.type).toBe("text/plain");
		expect(file?.size).toBe(21);
		expect(await file?.text()).toBe("test attachment bytes");

		const fetchNoId = vi.fn();
		vi.stubGlobal("fetch", fetchNoId);

		const missingId = await draftFileBytes("new:home", {
			id: undefined,
			name: "notes.txt",
			type: "text/plain",
		});
		expect(missingId).toBeNull();
		expect(fetchNoId).not.toHaveBeenCalled();

		const fetch404 = vi.fn().mockResolvedValue(new Response("Not Found", { status: 404 }));
		vi.stubGlobal("fetch", fetch404);

		const notFound = await draftFileBytes("new:home", {
			id: "att-missing",
			name: "notes.txt",
			type: "text/plain",
		});
		expect(fetch404).toHaveBeenCalledWith(
			"/api/drafts/new%3Ahome/attachments/att-missing",
			{ credentials: "include" },
		);
		expect(notFound).toBeNull();
	});

	it("keepSentFiles keeps listed and deletes unlisted sent| keys", async () => {
		const blobKeep = new Blob(["keep this"]);
		const blobDrop = new Blob(["drop this"]);
		const blobUnrelated = new Blob(["unrelated key"]);

		idbStore.set("sent|k-keep", blobKeep);
		idbStore.set("sent|k-drop", blobDrop);
		idbStore.set("draft|other", blobUnrelated);

		const newBlob = new Blob(["new sent file"]);
		await keepSentFiles(
			[{ key: "k-new", file: newBlob }],
			new Set(["k-keep", "k-new"]),
		);

		expect(idbStore.has("sent|k-keep")).toBe(true);
		expect(idbStore.get("sent|k-keep")).toBe(blobKeep);

		expect(idbStore.has("sent|k-new")).toBe(true);
		expect(idbStore.get("sent|k-new")).toBe(newBlob);

		expect(idbStore.has("sent|k-drop")).toBe(false);

		expect(idbStore.has("draft|other")).toBe(true);
		expect(idbStore.get("draft|other")).toBe(blobUnrelated);
	});

	it("sentFileBytes returns the stored bytes", async () => {
		const storedBlob = new Blob(["recalled bytes"], { type: "image/png" });
		idbStore.set("sent|file-key-1", storedBlob);

		const file = await sentFileBytes("file-key-1", "diagram.png", "image/png");
		expect(file?.name).toBe("diagram.png");
		expect(file?.type).toBe("image/png");
		expect(file?.size).toBe(14);
		expect(await file?.text()).toBe("recalled bytes");

		const absent = await sentFileBytes("non-existent-key", "missing.png", "image/png");
		expect(absent).toBeNull();
	});
});
