// @vitest-environment happy-dom
// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Sumit Patel

import { act } from "react";
import { createRoot } from "react-dom/client";
import { describe, expect, it, vi } from "vitest";
import {
	type IncidentRecord,
	IncidentRecordContext,
} from "@/components/incidents/record-context";
import { NoteDialog } from "./NoteDialog";

(
	globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }
).IS_REACT_ACT_ENVIRONMENT = true;

describe("NoteDialog", () => {
	it("saves the note to the incident and closes", async () => {
		const addNote = vi.fn((_t: string, done?: () => void) => done?.());
		const closed = vi.fn();
		const host = document.createElement("div");
		document.body.appendChild(host);
		const root = createRoot(host);
		await act(async () =>
			root.render(
				<IncidentRecordContext.Provider
					value={{ addNote, isSavingNote: false } as unknown as IncidentRecord}
				>
					<NoteDialog open onOpenChange={closed} />
				</IncidentRecordContext.Provider>,
			),
		);
		const box = document.querySelector<HTMLTextAreaElement>(
			'[data-testid="note-text"]',
		);
		await act(async () => {
			const set = Object.getOwnPropertyDescriptor(
				HTMLTextAreaElement.prototype,
				"value",
			)?.set;
			set?.call(box, "Rolled back by hand at 14:05");
			box?.dispatchEvent(new Event("input", { bubbles: true }));
		});
		await act(async () =>
			document
				.querySelector<HTMLButtonElement>('[data-testid="note-save"]')
				?.click(),
		);
		expect(addNote).toHaveBeenCalledWith(
			"Rolled back by hand at 14:05",
			expect.any(Function),
			expect.any(Function),
		);
		expect(closed).toHaveBeenCalledWith(false);
		await act(async () => root.unmount());
	});
});
