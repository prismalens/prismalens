// @vitest-environment happy-dom
// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Sumit Patel

import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { SendEnvelope } from "@/lib/composer-send";
import { NewThread } from "./NewThread";

let send: ((s: SendEnvelope) => Promise<unknown>) | null = null;
const createIncident = vi.fn();
const investigate = vi.fn();
const updateIncident = vi.fn(async () => ({}));
const navigate = vi.fn(async () => {});

vi.mock("./Composer", () => ({
	Composer: (props: { onSend: (s: SendEnvelope) => Promise<unknown> }) => {
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
	useUpdateIncident: () => ({ mutateAsync: updateIncident }),
}));
vi.mock("@/lib/api/hooks/use-threads-orpc", () => ({
	useStartThread: () => ({ mutateAsync: vi.fn() }),
	useForkThread: () => ({ mutateAsync: vi.fn() }),
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
	updateIncident.mockClear();
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
		const message = {
			text: "checkout is down",
			attachments: [],
			quotes: [],
			references: [],
		} as SendEnvelope;
		await expect(send?.(message)).rejects.toThrow("agent not ready");
		await send?.(message);
		expect(createIncident).toHaveBeenCalledTimes(1);
		expect(investigate).toHaveBeenLastCalledWith(
			expect.objectContaining({ id: "inc-1" }),
		);

		// After a success, the next message makes a new incident.
		createIncident.mockResolvedValue({ id: "inc-2" });
		await send?.(message);
		expect(createIncident).toHaveBeenCalledTimes(2);
	});

	it("a retry with edited words or severity writes them onto the incident it reuses", async () => {
		createIncident.mockResolvedValue({ id: "inc-1" });
		investigate
			.mockRejectedValueOnce(new Error("agent not ready"))
			.mockResolvedValue({ investigationId: "run-1" });
		await act(async () =>
			root.render(
				<NewThread subject={{ kind: "none" }} branch={null} incident="high" />,
			),
		);
		await expect(
			send?.({
				text: "checkout is down",
				attachments: [],
				quotes: [],
				references: [],
			} as SendEnvelope),
		).rejects.toThrow("agent not ready");
		await act(async () =>
			root.render(
				<NewThread
					subject={{ kind: "none" }}
					branch={null}
					incident="critical"
				/>,
			),
		);
		await send?.({
			text: "payments are down",
			attachments: [],
			quotes: [],
			references: [],
		} as SendEnvelope);
		expect(createIncident).toHaveBeenCalledTimes(1);
		expect(updateIncident).toHaveBeenCalledWith({
			id: "inc-1",
			title: "payments are down",
			description: "payments are down",
			severity: "critical",
		});
		expect(investigate).toHaveBeenLastCalledWith(
			expect.objectContaining({ id: "inc-1", brief: "payments are down" }),
		);
	});

	it("an unchanged retry writes nothing onto the incident", async () => {
		createIncident.mockResolvedValue({ id: "inc-1" });
		investigate
			.mockRejectedValueOnce(new Error("agent not ready"))
			.mockResolvedValue({ investigationId: "run-1" });
		await act(async () =>
			root.render(
				<NewThread subject={{ kind: "none" }} branch={null} incident="high" />,
			),
		);
		const message = {
			text: "checkout is down",
			attachments: [],
			quotes: [],
			references: [],
		} as SendEnvelope;
		await expect(send?.(message)).rejects.toThrow("agent not ready");
		await send?.(message);
		expect(updateIncident).not.toHaveBeenCalled();
	});

	it("a failed create for another service keeps the first incident for a retry on the first service", async () => {
		createIncident
			.mockResolvedValueOnce({ id: "inc-a" })
			.mockRejectedValueOnce(new Error("create failed"));
		investigate
			.mockRejectedValueOnce(new Error("agent not ready"))
			.mockResolvedValue({ investigationId: "run-1" });
		const on = (serviceId: string) => (
			<NewThread
				subject={{ kind: "service", serviceId } as never}
				branch={null}
				incident="high"
			/>
		);
		const message = {
			text: "checkout is down",
			attachments: [],
			quotes: [],
			references: [],
		} as SendEnvelope;
		await act(async () => root.render(on("svc-a")));
		await expect(send?.(message)).rejects.toThrow("agent not ready");
		await act(async () => root.render(on("svc-b")));
		await expect(send?.(message)).rejects.toThrow("create failed");
		await act(async () => root.render(on("svc-a")));
		await send?.(message);
		expect(createIncident).toHaveBeenCalledTimes(2);
		expect(investigate).toHaveBeenLastCalledWith(
			expect.objectContaining({ id: "inc-a" }),
		);
	});
});
