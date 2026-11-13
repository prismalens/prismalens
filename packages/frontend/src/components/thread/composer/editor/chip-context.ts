// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Sumit Patel

// What the composer shares with its chips, apart from the editor, so the box paints before the editor loads.
import { createContext } from "react";

/** The bytes behind a file chip, kept beside the document by its key. */
export interface ChipFile {
	file: File;
	preview?: string;
	/** Browser storage refused its bytes: lost on reload until sent. */
	unsaved?: boolean;
}

export interface ChipContextValue {
	files: ReadonlyMap<string, ChipFile>;
	/** A folded paste back into the box as text, in the chip's place. */
	pasteAsText: (key: string) => void;
	/** Why expanding would not fit the draft's cap. */
	pasteRefusal: (pasted: string) => string | null;
}

export const ChipContext = createContext<ChipContextValue>({
	files: new Map(),
	pasteAsText: () => {},
	pasteRefusal: () => null,
});

/** Enter on a selected chip opens its detail (#1101 category 7 row 14). */
export const CHIP_OPEN_EVENT = "pl-chip-open";
/** The `chip.expand` key on a selected folded paste (#1101). */
export const CHIP_EXPAND_EVENT = "pl-chip-expand";
