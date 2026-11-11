// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Sumit Patel

import type { ComposerScope, Quote, ReferenceRef } from "@prismalens/contracts";
import { describe, expect, it, vi } from "vitest";
import {
	interceptSend,
	messageFields,
	type SendEnvelope,
	type SendForward,
	type SendInterceptor,
	uploadEach,
} from "./composer-send";
import type { AttachmentView } from "./investigation-events";

describe("interceptSend", () => {
	it("forwards envelope and now when there are no interceptors, resolving sent", async () => {
		const env: SendEnvelope = {
			text: "hello",
			attachments: [],
			quotes: [],
			references: [],
		};
		const forward = vi.fn().mockResolvedValue(undefined);
		const receipt = await interceptSend(env, true, [], forward);

		expect(forward).toHaveBeenCalledTimes(1);
		expect(forward).toHaveBeenCalledWith(env, true);
		expect(receipt).toEqual({ result: "sent" });
	});

	it("skips forward when first interceptor returns null and second returns deferred", async () => {
		const env: SendEnvelope = {
			text: "hello",
			attachments: [],
			quotes: [],
			references: [],
		};
		const first = vi.fn().mockResolvedValue(null);
		const second = vi.fn().mockResolvedValue({ result: "deferred" as const });
		const forward = vi.fn().mockResolvedValue(undefined);

		const receipt = await interceptSend(env, true, [first, second], forward);

		expect(first).toHaveBeenCalledTimes(1);
		expect(second).toHaveBeenCalledTimes(1);
		expect(forward).not.toHaveBeenCalled();
		expect(receipt).toEqual({ result: "deferred" });
	});

	it("passes compact: true to forward when called later by a deferred interceptor", async () => {
		const env: SendEnvelope = {
			text: "hello",
			attachments: [],
			quotes: [],
			references: [],
		};
		let capturedForward: SendForward | null = null;
		const interceptor: SendInterceptor = (_e, _n, fwd) => {
			capturedForward = fwd;
			return { result: "deferred" };
		};
		const forward = vi.fn().mockResolvedValue(undefined);

		const receipt = await interceptSend(env, true, [interceptor], forward);
		expect(receipt).toEqual({ result: "deferred" });
		expect(forward).not.toHaveBeenCalled();

		await capturedForward!({ ...env, compact: true }, false);
		expect(forward).toHaveBeenCalledTimes(1);
		expect(forward).toHaveBeenCalledWith({ ...env, compact: true }, false);
	});
});

describe("messageFields", () => {
	it("returns quotes, references, draftScope, draftRev: 3, compact: true when set on envelope", () => {
		const quote: Quote = {
			source: {
				threadId: "11111111-1111-1111-1111-111111111111",
				kind: "transcript",
			},
			text: "quoted text",
		};
		const reference: ReferenceRef = {
			kind: "file",
			id: "src/a.ts",
			label: "src/a.ts",
		};
		const draftScope: ComposerScope = "thread:11111111-1111-1111-1111-111111111111";
		const env: SendEnvelope = {
			text: "message",
			attachments: [],
			quotes: [quote],
			references: [reference],
			draftScope,
			draftRev: 3,
			compact: true,
		};

		expect(messageFields(env)).toEqual({
			quotes: [quote],
			references: [reference],
			draftScope,
			draftRev: 3,
			compact: true,
		});
	});

	it("returns an empty object for an empty envelope", () => {
		const env: SendEnvelope = {
			text: "",
			attachments: [],
			quotes: [],
			references: [],
		};
		expect(messageFields(env)).toEqual({});
	});

	it("keeps draftRev: 0 when specified", () => {
		const env: SendEnvelope = {
			text: "",
			attachments: [],
			quotes: [],
			references: [],
			draftRev: 0,
		};
		expect(messageFields(env)).toEqual({ draftRev: 0 });
	});
});

describe("uploadEach", () => {
	it("uploads a File, passes already-uploaded attachment through, and keeps order", async () => {
		const file = new File(["test data"], "note.txt", { type: "text/plain" });
		const view: AttachmentView = {
			id: "att-already",
			name: "screenshot.png",
			mimeType: "image/png",
			size: 2048,
		};
		const upload = vi.fn().mockImplementation(async (f: File) => ({
			id: "att-uploaded",
			name: f.name,
			mimeType: f.type,
			size: f.size,
		}));

		const result = await uploadEach([file, view], upload);

		expect(upload).toHaveBeenCalledTimes(1);
		expect(upload).toHaveBeenCalledWith(file);
		expect(result).toEqual([
			{
				id: "att-uploaded",
				name: "note.txt",
				mimeType: "text/plain",
				size: file.size,
			},
			view,
		]);
	});
});
