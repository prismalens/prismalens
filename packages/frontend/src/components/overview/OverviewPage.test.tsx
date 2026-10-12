// @vitest-environment happy-dom
// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Sumit Patel

import type { HarnessStatus } from "@prismalens/contracts";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { NextActionId } from "./fixes";
import { OverviewPage } from "./OverviewPage";

const agent = (
	id: string,
	label: string,
	outcome: "answers-acp" | "sign-in-needed",
): HarnessStatus => ({
	id,
	label,
	binary: id,
	installed: true,
	tested: null,
	install: "",
	defaultModel: null,
	localDefault: { permission: null },
	modelVia: "acp",
	loginHint: "",
	envModel: null,
	windowsOnlyPath: null,
	models: { source: "harness", asOf: "", entries: [] },
	checked: {
		at: "",
		outcome,
		detail: "",
		version: null,
		companionVersion: null,
		servedModel: null,
		effort: null,
		modes: null,
		efforts: null,
		images: false,
		sandbox: null,
	},
});

const opencode = agent("opencode", "OpenCode", "answers-acp");
let claude = agent("claude-code", "Claude Code", "answers-acp");
const investigate = vi.fn(async () => {});

vi.mock("@/components/agent/AgentPicker", async (importOriginal) => ({
	...(await importOriginal<typeof import("@/components/agent/AgentPicker")>()),
	useAgentChoice: () => ({
		harnesses: [opencode, claude],
		effective: opencode,
		model: "",
		models: {},
		efforts: {},
		axes: { accessLevels: {} },
	}),
}));

vi.mock("./use-overview", () => ({
	useOverview: () => ({
		record: {
			incident: { id: "inc-1" },
			draftChoice: { harness: "claude-code" },
			investigate,
		},
	}),
}));

vi.mock("./SituationCard", () => ({
	SituationCard: ({ onAction }: { onAction: (id: NextActionId) => void }) => (
		<button
			type="button"
			data-testid="next-investigate"
			onClick={() => onAction("investigate")}
		/>
	),
}));

vi.mock("./OverviewComposer", async (importOriginal) => ({
	...(await importOriginal<typeof import("./OverviewComposer")>()),
	OverviewComposer: () => null,
}));
vi.mock("@/components/run/IncidentHeader", () => ({
	IncidentHeader: () => null,
}));
vi.mock("./LatestRunStrip", () => ({ LatestRunStrip: () => null }));
vi.mock("./ImpactCard", () => ({ ImpactCard: () => null }));
vi.mock("./StopImpactCard", () => ({ StopImpactCard: () => null }));
vi.mock("./WhyCard", () => ({ WhyCard: () => null }));
vi.mock("./ChangesCard", () => ({ ChangesCard: () => null }));
vi.mock("@tanstack/react-router", () => ({ useNavigate: () => vi.fn() }));

(
	globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }
).IS_REACT_ACT_ENVIRONMENT = true;

let container: HTMLDivElement;
let root: Root;

beforeEach(() => {
	container = document.createElement("div");
	document.body.appendChild(container);
	root = createRoot(container);
	investigate.mockClear();
	claude = agent("claude-code", "Claude Code", "answers-acp");
});

afterEach(async () => {
	await act(async () => root.unmount());
	container.remove();
});

async function pressInvestigate() {
	await act(async () => root.render(<OverviewPage />));
	await act(async () =>
		container
			.querySelector<HTMLButtonElement>('[data-testid="next-investigate"]')
			?.click(),
	);
}

describe("Next strip Investigate (w8-7)", () => {
	it("starts on the agent the overview box shows, not the Settings agent", async () => {
		await pressInvestigate();
		expect(investigate).toHaveBeenCalledWith({
			accessLevel: "supervised",
			harness: "claude-code",
			stay: true,
		});
	});

	it("starts nothing when the box's agent cannot run", async () => {
		claude = agent("claude-code", "Claude Code", "sign-in-needed");
		await pressInvestigate();
		expect(investigate).not.toHaveBeenCalled();
	});
});
