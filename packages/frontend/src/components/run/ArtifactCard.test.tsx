// @vitest-environment happy-dom
// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Sumit Patel

import type { Artifact, CanonicalEvent } from "@prismalens/contracts";
import { ARTIFACT_HTML_CHARS } from "@prismalens/contracts/schemas";
import { act, type ReactNode } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { deriveTranscript } from "@/lib/investigation-events";
import { ArtifactCard, NO_FETCH } from "./ArtifactCard";

vi.mock("@/components/shared/Hint", () => ({
	Hint: ({ children }: { children: ReactNode }) => children,
}));

(
	globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }
).IS_REACT_ACT_ENVIRONMENT = true;

let container: HTMLDivElement;
let root: Root;

beforeEach(() => {
	container = document.createElement("div");
	document.body.appendChild(container);
	root = createRoot(container);
});

afterEach(async () => {
	await act(async () => root.unmount());
	container.remove();
	document.body.innerHTML = "";
});

const artifact: Artifact = {
	id: "a1",
	title: "Pool timeline",
	html: "<h1>Pool</h1><p>full at 01:05</p>",
	at: "2026-10-10T01:05:00.000Z",
};

const mount = async (a: Artifact) =>
	act(async () => root.render(<ArtifactCard artifact={a} />));

describe("ArtifactCard", () => {
	it("draws the title and the page in a frame that allows nothing", async () => {
		await mount(artifact);
		expect(container.textContent).toContain("Pool timeline");
		const frame = container.querySelector("iframe");
		expect(frame?.getAttribute("sandbox")).toBe("");
		expect(frame?.getAttribute("title")).toBe("Pool timeline");
		const doc = frame?.getAttribute("srcdoc") ?? "";
		expect(doc).toContain(artifact.html);
		expect(doc).toContain("color-scheme");
		expect(doc.indexOf("<style>")).toBeLessThan(doc.indexOf(artifact.html));
		expect(doc.startsWith(NO_FETCH)).toBe(true);
	});

	it("Open larger opens a dialog with a second sandboxed frame", async () => {
		await mount(artifact);
		await act(async () =>
			container
				.querySelector<HTMLButtonElement>('[data-testid="artifact-open"]')
				?.click(),
		);
		const big = document.querySelector('[data-testid="artifact-frame-larger"]');
		expect(big?.getAttribute("sandbox")).toBe("");
		expect(big?.getAttribute("srcdoc")).toContain(artifact.html);
		expect(document.querySelectorAll("iframe")).toHaveLength(2);
	});

	it.each([
		["empty", "  "],
		["too long", "x".repeat(ARTIFACT_HTML_CHARS + 1)],
	])("says so instead of a frame when the page is %s", async (_, html) => {
		await mount({ ...artifact, html });
		expect(container.querySelector("iframe")).toBeNull();
		expect(
			container.querySelector('[data-testid="state-problem"]'),
		).not.toBeNull();
		expect(container.querySelector('[data-testid="artifact-open"]')).toBeNull();
	});
});

describe("an artifact in the transcript", () => {
	const base = (seq: number, s: number) => ({
		runId: "00000000-0000-4000-8000-000000000001",
		branchId: "run",
		path: [],
		seq,
		ts: new Date(Date.UTC(2026, 9, 10, 1, 5, s)).toISOString(),
	});
	const step = (seq: number, s: number, text: string): CanonicalEvent => ({
		kind: "agent_step",
		...base(seq, s),
		text,
		toolCalls: [],
	});

	it("lands at the seq it was published, between the prose around it", () => {
		const items = deriveTranscript([
			step(1, 0, "Looking"),
			{ kind: "artifact_published", ...base(2, 1), artifact },
			step(3, 2, "Done"),
		]);
		expect(items.map((i) => i.kind)).toEqual(["prose", "artifact", "prose"]);
		const at = items[1];
		expect(at?.kind === "artifact" && at.artifact.id).toBe("a1");
	});
});
