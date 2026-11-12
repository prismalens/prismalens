// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Sumit Patel

import { describe, expect, it, vi } from "vitest";
import type {
	CanonicalEvent,
	CommitFrame,
	DoneFrame,
	LiveFrame,
} from "@prismalens/contracts";
import {
	ResumableStream,
	type StreamSink,
	type StreamSource,
} from "./resumable-stream.js";

const RUN_ID = "run-1111-1111";

function makeEvent(seq: number, branchId = "main", message = "test"): CanonicalEvent {
	return {
		kind: "error",
		runId: RUN_ID,
		branchId,
		path: [],
		seq,
		ts: new Date("2026-07-05T00:00:00Z").toISOString(),
		message,
	};
}

interface StoredRow {
	seq: number;
	branchId: string;
	ordinal: number;
	event: string;
}

class FakeStreamSource implements StreamSource {
	gen = 0;
	revision = 0;
	lost = 0;
	status = "running";
	rowList: StoredRow[] = [];
	onLiveCallback: ((event: CanonicalEvent) => void) | null = null;
	onDoneCallback: (() => void) | null = null;
	onUnknownCallback: (() => void) | null = null;
	onCommitCallback: ((what: "commit" | "reset") => void) | null = null;
	onBeforeYield: ((after: number, through: number) => void) | null = null;

	async head(
		_threadId: string,
	): Promise<{ gen: number; revision: number; lost: number; status: string }> {
		return {
			gen: this.gen,
			revision: this.revision,
			lost: this.lost,
			status: this.status,
		};
	}

	async *rows(
		_threadId: string,
		after: number,
		through: number,
	): AsyncIterable<StoredRow[]> {
		if (this.onBeforeYield) {
			this.onBeforeYield(after, through);
		}
		const matching = this.rowList.filter(
			(r) => r.ordinal > after && r.ordinal <= through,
		);
		yield matching;
	}

	parseRow(_threadId: string, raw: string): CanonicalEvent | null {
		try {
			return JSON.parse(raw) as CanonicalEvent;
		} catch {
			return null;
		}
	}

	subscribe(
		_threadId: string,
		onEvent: (event: CanonicalEvent) => void,
		onDone: () => void,
		onUnknown: () => void,
	): { unsubscribe: () => void } {
		this.onLiveCallback = onEvent;
		this.onDoneCallback = onDone;
		this.onUnknownCallback = onUnknown;
		return {
			unsubscribe: () => {
				this.onLiveCallback = null;
				this.onDoneCallback = null;
				this.onUnknownCallback = null;
			},
		};
	}

	onCommit(
		_threadId: string,
		fn: (what: "commit" | "reset") => void,
	): () => void {
		this.onCommitCallback = fn;
		return () => {
			this.onCommitCallback = null;
		};
	}
}

class RecordingStreamSink implements StreamSink {
	frames: { name: string; data: unknown; id?: string }[] = [];
	closed: boolean | null = null;

	send(name: string, data: unknown, id?: string): void {
		this.frames.push({ name, data, id });
	}

	close(clean: boolean): void {
		this.closed = clean;
	}
}

describe("ResumableStream", () => {
	it("Resume from 0.2 with rows 1..5 sends one commit frame whose acks are ordinals 3..5 and whose through is 5. The sink's id is 0.5", async () => {
		const source = new FakeStreamSource();
		source.gen = 0;
		source.revision = 5;
		for (let i = 1; i <= 5; i++) {
			source.rowList.push({
				seq: i,
				branchId: "main",
				ordinal: i,
				event: JSON.stringify(makeEvent(i)),
			});
		}
		const sink = new RecordingStreamSink();
		const stream = new ResumableStream(source, "thread-1", { gen: 0, ordinal: 2 }, sink);

		await stream.start();

		expect(sink.frames).toHaveLength(1);
		const commit = sink.frames[0];
		expect(commit.name).toBe("commit");
		expect(commit.id).toBe("0.5");
		const data = commit.data as CommitFrame;
		expect(data.through).toBe(5);
		expect(data.acks).toEqual([
			["main:3", 3],
			["main:4", 4],
			["main:5", 5],
		]);
		stream.stop();
	});

	it("A cursor whose gen differs sends reset with the source's gen, and closes clean", async () => {
		const source = new FakeStreamSource();
		source.gen = 2;
		source.revision = 10;
		const sink = new RecordingStreamSink();
		const stream = new ResumableStream(source, "thread-1", { gen: 1, ordinal: 5 }, sink);

		await stream.start();

		expect(sink.frames).toHaveLength(1);
		expect(sink.frames[0].name).toBe("reset");
		expect(sink.frames[0].data).toEqual({ gen: 2 });
		expect(sink.closed).toBe(true);
		stream.stop();
	});

	it("Relay onDone fired DURING the replay (call it from inside the fake rows() before it yields) sends done only after the commit frame. Done's through is the last ordinal", async () => {
		const source = new FakeStreamSource();
		source.gen = 0;
		source.revision = 3;
		for (let i = 1; i <= 3; i++) {
			source.rowList.push({
				seq: i,
				branchId: "main",
				ordinal: i,
				event: JSON.stringify(makeEvent(i)),
			});
		}
		source.onBeforeYield = () => {
			source.onDoneCallback?.();
		};

		const sink = new RecordingStreamSink();
		const stream = new ResumableStream(source, "thread-1", { gen: 0, ordinal: 0 }, sink);

		await stream.start();

		expect(sink.frames.map((f) => f.name)).toEqual(["commit", "done"]);
		const done = sink.frames[1].data as DoneFrame;
		expect(done.through).toBe(3);
		expect(sink.closed).toBe(true);
		stream.stop();
	});

	it("Emit before commit: a live event main:9 is sent as live. When row ordinal 6 with key main:9 is then committed and pull() runs, the commit frame acks [\"main:9\",6] and its events is empty", async () => {
		const source = new FakeStreamSource();
		source.gen = 0;
		source.revision = 5;
		for (let i = 1; i <= 5; i++) {
			source.rowList.push({
				seq: i,
				branchId: "main",
				ordinal: i,
				event: JSON.stringify(makeEvent(i)),
			});
		}
		const sink = new RecordingStreamSink();
		const stream = new ResumableStream(source, "thread-1", { gen: 0, ordinal: 5 }, sink);

		await stream.start();
		expect(sink.frames).toHaveLength(0); // initial start caught up to 5

		// Live event arrives
		const liveEvent = makeEvent(9, "main");
		source.onLiveCallback?.(liveEvent);

		expect(sink.frames).toHaveLength(1);
		expect(sink.frames[0].name).toBe("live");
		expect((sink.frames[0].data as LiveFrame).event).toEqual(liveEvent);

		// Now row 6 arrives with key main:9
		source.revision = 6;
		source.rowList.push({
			seq: 9,
			branchId: "main",
			ordinal: 6,
			event: JSON.stringify(liveEvent),
		});

		await stream.pull();

		expect(sink.frames).toHaveLength(2);
		expect(sink.frames[1].name).toBe("commit");
		const commitData = sink.frames[1].data as CommitFrame;
		expect(commitData.acks).toEqual([["main:9", 6]]);
		expect(commitData.events).toEqual([]);
		stream.stop();
	});

	it("UNKNOWN with the head status completed sends done. UNKNOWN with status running closes with clean=false and sends no done", async () => {
		// Case 1: head status completed
		const source1 = new FakeStreamSource();
		source1.gen = 0;
		source1.revision = 2;
		source1.status = "completed";
		const sink1 = new RecordingStreamSink();
		const stream1 = new ResumableStream(source1, "thread-1", { gen: 0, ordinal: 2 }, sink1);

		await stream1.start();
		source1.onUnknownCallback?.();
		// Allow finish to run
		await new Promise((r) => setTimeout(r, 10));

		expect(sink1.frames.map((f) => f.name)).toContain("done");
		expect(sink1.closed).toBe(true);
		stream1.stop();

		// Case 2: head status running
		const source2 = new FakeStreamSource();
		source2.gen = 0;
		source2.revision = 2;
		source2.status = "running";
		const sink2 = new RecordingStreamSink();
		const stream2 = new ResumableStream(source2, "thread-1", { gen: 0, ordinal: 2 }, sink2);

		await stream2.start();
		source2.onUnknownCallback?.();
		await new Promise((r) => setTimeout(r, 10));

		expect(sink2.frames.map((f) => f.name)).not.toContain("done");
		expect(sink2.closed).toBe(false);
		stream2.stop();
	});

	it("A gap longer than 50 rows (rows 1..120, cursor 0.0) is fully acked across the commit frames, ending at through 120", async () => {
		const source = new FakeStreamSource();
		source.gen = 0;
		source.revision = 120;
		for (let i = 1; i <= 120; i++) {
			source.rowList.push({
				seq: i,
				branchId: "main",
				ordinal: i,
				event: JSON.stringify(makeEvent(i)),
			});
		}
		const sink = new RecordingStreamSink();
		const stream = new ResumableStream(source, "thread-1", { gen: 0, ordinal: 0 }, sink);

		await stream.start();

		const commitFrames = sink.frames.filter((f) => f.name === "commit");
		// Rows are read in ranges of 500 ordinals, so 120 rows make one frame.
		expect(commitFrames).toHaveLength(1);
		const allAcks = commitFrames.flatMap((f) => (f.data as CommitFrame).acks);
		expect(allAcks).toHaveLength(120);
		expect(allAcks[0]).toEqual(["main:1", 1]);
		expect(allAcks[119]).toEqual(["main:120", 120]);
		const lastFrame = commitFrames[commitFrames.length - 1].data as CommitFrame;
		expect(lastFrame.through).toBe(120);
		stream.stop();
	});

	it("More than 1,000 live events during the replay sends resync", async () => {
		const source = new FakeStreamSource();
		source.gen = 0;
		source.revision = 1;
		source.rowList.push({
			seq: 1,
			branchId: "main",
			ordinal: 1,
			event: JSON.stringify(makeEvent(1)),
		});
		source.onBeforeYield = () => {
			for (let i = 1; i <= 1001; i++) {
				source.onLiveCallback?.(makeEvent(i, "main"));
			}
		};

		const sink = new RecordingStreamSink();
		const stream = new ResumableStream(source, "thread-1", { gen: 0, ordinal: 0 }, sink);

		await stream.start();

		expect(sink.frames.map((f) => f.name)).toContain("resync");
		expect(sink.closed).toBe(true);
		stream.stop();
	});
});
