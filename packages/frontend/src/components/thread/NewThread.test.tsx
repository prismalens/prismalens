// @vitest-environment happy-dom
// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Sumit Patel

import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { ComposerSend } from "./Composer";
import { NewThread } from "./NewThread";

let send: ((s: ComposerSend) => Promise<void>) | null = null;
const createIncident = vi.fn();
const investigate = vi.fn();
const navigate = vi.fn(async () => {});

vi.mock("./Composer", () => ({
	Composer: (props: { onSend: (s: ComposerSend) => Promise<void> }) => {
		send = props.onSend;
		return <span data-testid="composer" />;
	},
}));
vi.mock("@/components/agent/AgentPicker", () => ({
	useAgentChoice: () => ({
		harnesses: [],
		effective: undefined,
		model: "",
		models: {},
		efforts: {},
		axes: { accessLevels: {} },
		isLoading: false,
	}),
	defaultAccessOf: () => ({ level: { level: "supervised" } }),
	unreadyLine: () => null,
}));
vi.mock("@/lib/api/hooks", () => ({
	useCreateIncident: () => ({ mutateAsync: createIncident }),
	useInvestigateIncident: () => ({ mutateAsync: investigate }),
}));
vi.mock("@/lib/api/hooks/use-threads-orpc", () => ({
	useStartThread: () => ({ mutateAsync: vi.fn() }),
}));
vi.mock("@tanstack/react-router", () => ({ useNavigate: () => navigate }));

(
	globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }
).IS_REACT_ACT_ENVIRONMENT = true;

let container: HTMLDivElement;
let root: Root;
beforeEach(() => {
	send = null;
	createIncident.mockReset();
	investigate.mockReset();
	container = document.createElement("div");
	document.body.appendChild(container);
	root = createRoot(container);
});
afterEach(async () => {
	await act(async () => root.unmount());
	container.remove();
});

describe("NewThread with Incident on (#1020)", () => {
	it("a retry after a refused investigation reuses the incident it made, never a second one", async () => {
		createIncident.mockResolvedValue({ id: "inc-1" });
		investigate
			.mockRejectedValueOnce(new Error("agent not ready"))
			.mockResolvedValue({ investigationId: "run-1" });
		await act(async () =>
			root.render(
				<NewThread subject={{ kind: "none" }} branch={null} incident="high" />,
			),
		);
		const message = { text: "checkout is down", files: [] } as ComposerSend;
		await expect(send?.(message)).rejects.toThrow("agent not ready");
		await send?.(message);
		expect(createIncident).toHaveBeenCalledTimes(1);
		expect(investigate).toHaveBeenLastCalledWith(
			expect.objectContaining({ id: "inc-1" }),
		);

		// An edited retry is a different incident, not the first one's stale text.
		createIncident.mockResolvedValue({ id: "inc-edit" });
		investigate.mockRejectedValueOnce(new Error("agent not ready"));
		await expect(
			send?.({ text: "payments is down", files: [] } as ComposerSend),
		).rejects.toThrow("agent not ready");
		createIncident.mockResolvedValue({ id: "inc-edited" });
		await send?.({ text: "payments is down hard", files: [] } as ComposerSend);
		expect(investigate).toHaveBeenLastCalledWith(
			expect.objectContaining({ id: "inc-edited" }),
		);

		// After a success, the next message makes a new incident.
		createIncident.mockResolvedValue({ id: "inc-2" });
		await send?.(message);
		expect(createIncident).toHaveBeenCalledTimes(4);
	});
});
