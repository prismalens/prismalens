// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Sumit Patel

import { beforeEach, describe, expect, it, vi } from "vitest";
import type { PrismaService } from "../../core/prisma/prisma.service.js";
import { readShortcuts, writeShortcuts } from "./shortcuts.js";

const mockFindUnique = vi.fn();
const mockUpsert = vi.fn();
const mockPrisma = {
	setting: {
		findUnique: mockFindUnique,
		upsert: mockUpsert,
	},
} as unknown as Pick<PrismaService, "setting">;

describe("shortcuts", () => {
	beforeEach(() => {
		vi.clearAllMocks();
	});

	it("readShortcuts returns {keys:{}} with no row and with an unreadable row", async () => {
		mockFindUnique.mockResolvedValueOnce(null);
		const empty = await readShortcuts(mockPrisma);
		expect(empty).toEqual({ keys: {} });

		mockFindUnique.mockResolvedValueOnce({
			key: "ui.shortcuts",
			value: "not-json",
		});
		const invalidJson = await readShortcuts(mockPrisma);
		expect(invalidJson).toEqual({ keys: {} });

		mockFindUnique.mockResolvedValueOnce({
			key: "ui.shortcuts",
			value: JSON.stringify({ keys: "not-an-object" }),
		});
		const invalidSchema = await readShortcuts(mockPrisma);
		expect(invalidSchema).toEqual({ keys: {} });
	});

	it("writeShortcuts round-trips", async () => {
		const next = {
			keys: {
				search: "Mod+P",
			},
		};

		mockUpsert.mockResolvedValueOnce(undefined);
		mockFindUnique.mockResolvedValueOnce({
			key: "ui.shortcuts",
			value: JSON.stringify(next),
			type: "json",
			category: "ui",
		});

		const result = await writeShortcuts(mockPrisma, next);
		expect(mockUpsert).toHaveBeenCalledWith({
			where: { key: "ui.shortcuts" },
			create: {
				key: "ui.shortcuts",
				value: JSON.stringify(next),
				type: "json",
				category: "ui",
			},
			update: { value: JSON.stringify(next) },
		});
		expect(result).toEqual(next);
	});
});
