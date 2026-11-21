// @vitest-environment happy-dom
// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Sumit Patel

import type { HarnessStatus } from "@prismalens/contracts";
import { act, type ReactNode } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";

// The editor's code is not loaded at mount here: the box starts as the stand-in.
vi.mock("@/components/agent/AgentPicker", () => ({
	ModelChip: () => <span data-testid="model-chip" />,
	EffortChip: () => <span data-testid="effort-chip" />,
	ModeChip: () => <span data-testid="access-chip" />,
	effortLevels: () => [],
	useAgentChoice: () => ({ axes: { accessLevels: {} } }),
	defaultAccessOf: () => ({
		level: { level: "supervised", from: "prismalens" },
	}),
}));
vi.mock("@/components/shared/Hint", () => ({
	Hint: ({ children }: { children: ReactNode }) => children,
}));
vi.mock("@/lib/api/hooks/use-drafts-orpc", async (importOriginal) => ({
	...(await importOriginal<typeof import("@/lib/api/hooks/use-drafts-orpc")>()),
	fetchServerDraft: async () => null,
	useServerDraft: () => ({ data: null, isPending: false }),
	useSaveDraft: () => ({ mutateAsync: vi.fn(async () => ({ rev: 1 })) }),
}));

/** Holds the created editor back from the composer until `release`, as a slow first frame does. */
const gate: { held: boolean; release: (() => void) | null } = {
	held: false,
	release: null,
};
vi.mock("./composer/editor/kit", async (importOriginal) => {
	const kit = await importOriginal<typeof import("./composer/editor/kit")>();
	return {
		...kit,
		EditorHost: (props: Parameters<typeof kit.EditorHost>[0]) => (
			<kit.EditorHost
				{...props}
				onEditor={(ed) => {
					if (ed && gate.held) gate.release = () => props.onEditor(ed);
					else props.onEditor(ed);
				}}
			/>
		),
	};
});

(
	globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }
).IS_REACT_ACT_ENVIRONMENT = true;

let container: HTMLDivElement;
let root: Root;

beforeEach(() => {
	gate.held = false;
	gate.release = null;
	container = document.createElement("div");
	document.body.appendChild(container);
	root = createRoot(container);
});

afterEach(async () => {
	await act(async () => root.unmount());
	container.remove();
});

const q = (id: string) =>
	document.body.querySelector<HTMLElement>(`[data-testid="${id}"]`);

/** A fresh module graph each time: once loaded, the editor's code makes a new box start without the stand-in. */
async function renderStandIn() {
	vi.resetModules();
	const { Composer } = await import("./Composer");
	const { loadEditorKit } = await import("./composer/editor/load-kit");
	await act(async () =>
		root.render(
			<Composer
				state="ready"
				onSend={vi.fn()}
				placeholder="Brief the agent"
				autoFocus
				choice={{
					harness: {
						id: "claude-code",
						label: "Claude Code",
						checked: { outcome: "answers-acp", images: true, efforts: [] },
					} as unknown as HarnessStatus,
					model: "",
					effort: null,
					accessLevel: "supervised",
				}}
				onChoice={vi.fn()}
			/>,
		),
	);
	const standIn = q("composer-stand-in");
	expect(document.activeElement).toBe(standIn);
	// A key in the focused stand-in starts the editor; it is created, but not yet handed over.
	gate.held = true;
	await act(async () => {
		standIn?.dispatchEvent(new KeyboardEvent("keydown", { bubbles: true }));
		await loadEditorKit();
	});
	expect(q("composer-stand-in")).toBeNull();
	expect(gate.release).not.toBeNull();
}

const frames = () => act(async () => new Promise((r) => setTimeout(r, 50)));

it("keeps the stand-in's height while the editor has no frame, so the chips don't move under the pointer", async () => {
	await renderStandIn();
	expect(q("composer-editor")?.className).toContain("min-h-13.5");
});

it("a late editor leaves focus where a press moved it before the editor arrived", async () => {
	const chip = document.createElement("button");
	document.body.appendChild(chip);
	await renderStandIn();
	chip.focus();
	await act(async () => gate.release?.());
	await frames();
	expect(q("composer-input")).not.toBeNull();
	expect(document.activeElement).toBe(chip);
	chip.remove();
});

it("a late editor takes the stand-in's dropped focus at once, so a press before the next frame keeps its own", async () => {
	const chip = document.createElement("button");
	document.body.appendChild(chip);
	await renderStandIn();
	expect(document.activeElement).toBe(document.body);
	// Frames run when the test says, so the press lands between the editor's arrival and the next one.
	const queued: FrameRequestCallback[] = [];
	const raf = vi
		.spyOn(window, "requestAnimationFrame")
		.mockImplementation((cb) => queued.push(cb));
	await act(async () => gate.release?.());
	expect(document.activeElement).toBe(q("composer-input"));
	chip.focus();
	await act(async () => {
		for (const cb of queued.splice(0)) cb(performance.now());
	});
	raf.mockRestore();
	expect(document.activeElement).toBe(chip);
	chip.remove();
});
