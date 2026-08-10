// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Sumit Patel

/**
 * InvestigationStreamController tests — what actually goes out ON THE WIRE.
 *
 * The relay's own suite asserts which terminal CALLBACK fires for each topic state. That
 * is one translation short of the property that matters: the defect in #388 was not a
 * wrong callback, it was two different topic states serialising to the same bytes. A
 * client sees frames, not callbacks, so the distinction has to be asserted here, against
 * the strings written to the response.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { Response } from "express";
import {
	InProcessEventBus,
	type RelayMessage,
	runEventsTopic,
} from "../../infrastructure/dispatch/event-bus.js";
import { InvestigationStreamController } from "./investigation-stream.controller.js";
import { StreamRelayService } from "./stream-relay.service.js";

const ID = "11111111-1111-4111-8111-111111111111";

/** Deferral on a terminal outcome with no live stream behind it. Mirrors TERMINAL_DELAY_MS. */
const TERMINAL_DELAY_MS = 50;
/** The controller's grace between sending `done` and ending the response. */
const DONE_CLOSE_DELAY_MS = 100;

/** Long enough for every deferred terminal path in the controller to have run. */
const SETTLE_MS = TERMINAL_DELAY_MS + DONE_CLOSE_DELAY_MS + 10;

/**
 * The slice of an express `Response` this controller touches, recording what it is told
 * to write. A real socket would add nothing: the assertions are all about the frames.
 */
function fakeResponse(): { res: Response; frames: string[]; ended: () => boolean } {
	const frames: string[] = [];
	let ended = false;
	const res = {
		writeHead: vi.fn(),
		flushHeaders: vi.fn(),
		write: vi.fn((chunk: string) => {
			frames.push(chunk);
			return true;
		}),
		end: vi.fn(() => {
			ended = true;
		}),
		on: vi.fn(),
		off: vi.fn(),
	};
	// `ended` is a function, not a getter: a getter read through an object rest spread
	// snapshots at destructure time and reports the response open forever.
	return { res: res as unknown as Response, frames, ended: () => ended };
}

/** Every `data:` payload the client would parse, in order. */
function payloads(frames: string[]): string[] {
	return frames.flatMap((frame) =>
		frame
			.split("\n")
			.filter((line) => line.startsWith("data: "))
			.map((line) => line.slice("data: ".length)),
	);
}

describe("InvestigationStreamController", () => {
	let bus: InProcessEventBus;
	let relay: StreamRelayService;
	let controller: InvestigationStreamController;

	beforeEach(() => {
		vi.useFakeTimers();
		bus = new InProcessEventBus();
		relay = new StreamRelayService(bus);
		controller = new InvestigationStreamController(relay);
	});

	afterEach(() => {
		relay.onModuleDestroy();
		vi.useRealTimers();
	});

	describe("an UNKNOWN topic", () => {
		it("ends the response with NO done frame, so the client's error path engages", () => {
			const { res, frames, ended } = fakeResponse();

			controller.stream(ID, res);
			vi.advanceTimersByTime(SETTLE_MS);

			// The whole fix. A `done` here is a claim this process cannot back: an absent
			// buffer is what a still-running investigation looks like across an API
			// restart, and the client would mark it completed forever (#388).
			expect(payloads(frames)).toEqual([]);
			expect(ended()).toBe(true);
		});
	});

	describe("a FINISHED topic", () => {
		it("replays the buffer and then sends the done frame", () => {
			relay.attach(ID);
			bus.publish<RelayMessage>(runEventsTopic(ID), {
				kind: "event",
				event: {
					kind: "error",
					runId: ID,
					branchId: "main",
					path: [],
					seq: 0,
					ts: new Date(0).toISOString(),
					message: "a1",
				},
			});
			bus.publish<RelayMessage>(runEventsTopic(ID), { kind: "done" });

			const { res, frames, ended } = fakeResponse();

			controller.stream(ID, res);
			vi.advanceTimersByTime(SETTLE_MS);

			const sent = payloads(frames);
			expect(sent).toHaveLength(2);
			expect(JSON.parse(sent[0] as string)).toMatchObject({ message: "a1" });
			expect(JSON.parse(sent[1] as string)).toEqual({ type: "done" });
			expect(ended()).toBe(true);
		});
	});

	describe("an ACTIVE topic", () => {
		it("streams live events and closes on the run's own done", () => {
			relay.attach(ID);

			const { res, frames, ended } = fakeResponse();
			controller.stream(ID, res);

			bus.publish<RelayMessage>(runEventsTopic(ID), {
				kind: "event",
				event: {
					kind: "error",
					runId: ID,
					branchId: "main",
					path: [],
					seq: 0,
					ts: new Date(0).toISOString(),
					message: "live",
				},
			});
			bus.publish<RelayMessage>(runEventsTopic(ID), { kind: "done" });
			vi.advanceTimersByTime(SETTLE_MS);

			const sent = payloads(frames);
			expect(sent).toHaveLength(2);
			expect(JSON.parse(sent[0] as string)).toMatchObject({ message: "live" });
			expect(JSON.parse(sent[1] as string)).toEqual({ type: "done" });
			expect(ended()).toBe(true);
		});
	});
});
