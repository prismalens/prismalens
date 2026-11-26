// @vitest-environment happy-dom
// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Sumit Patel

import type { HarnessStatus } from "@prismalens/contracts";
import { act } from "react";
import { describe, expect, it, vi } from "vitest";
import { TooltipProvider } from "@/components/ui/tooltip";
import { renderWithApp } from "@/test/render";
import { ModelsSection } from "./AgentDetail";

const agent = {
	id: "codex",
	label: "Codex",
	binary: "codex",
	installed: true,
	models: {
		source: "harness",
		asOf: "",
		entries: [
			{ id: "gpt-a", name: "GPT A" },
			{ id: "gpt-b", name: "GPT B" },
		],
	},
} as unknown as HarnessStatus;

describe("Models favourites (#1180)", () => {
	it("a second favourite after a failed read-back sends both favourites", async () => {
		let settings = { harness: "auto", favourites: [] as unknown[] };
		let reads = 0;
		const sent: unknown[] = [];
		const app = await renderWithApp(
			<TooltipProvider>
				<ModelsSection agent={agent} />
			</TooltipProvider>,
			{
				api: {
					"settings.harnesses.getHarnesses": { harnesses: [agent] },
					"settings.harnesses.getSettings": () => {
						reads += 1;
						if (reads === 2) throw new Error("offline");
						return settings;
					},
					"settings.harnesses.updateSettings": ({ body }) => {
						sent.push(body);
						settings = { ...settings, ...(body as object) };
						return settings;
					},
				},
			},
		);
		const heart = (name: string) =>
			app.container.querySelector<HTMLButtonElement>(
				`[aria-label="Favourite ${name}"]`,
			);
		await vi.waitFor(() => {
			if (!heart("GPT A")) throw new Error("no models yet");
		});
		await act(async () => heart("GPT A")?.click());
		await vi.waitFor(() => {
			if (reads < 2 || heart("GPT B")?.getAttribute("aria-disabled") === "true")
				throw new Error("first save not settled");
		});
		await act(async () => heart("GPT B")?.click());
		await vi.waitFor(() => {
			if (sent.length < 2) throw new Error("second save not sent");
		});
		expect(sent).toEqual([
			{ favourites: [{ harness: "codex", model: "gpt-a" }] },
			{
				favourites: [
					{ harness: "codex", model: "gpt-a" },
					{ harness: "codex", model: "gpt-b" },
				],
			},
		]);
	});
});
