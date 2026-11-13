// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Sumit Patel

import { useCallback, useState } from "react";

const KEY = "pl.details.docked";

export function readDocked(): boolean {
	try {
		return localStorage.getItem(KEY) !== "0";
	} catch {
		return true;
	}
}

/** The details card is docked until the user closes it, and stays as they left it (sheet §9.5). */
export function useDetailsDocked(): [boolean, (docked: boolean) => void] {
	const [docked, setState] = useState(readDocked);
	const set = useCallback((next: boolean) => {
		setState(next);
		try {
			localStorage.setItem(KEY, next ? "1" : "0");
		} catch {}
	}, []);
	return [docked, set];
}

/** Whether a card has more than the agent and the machine: only then does it dock unasked (#1101). */
export function cardHasState(rows: readonly { id: string }[] | null): boolean {
	return !!rows?.some((r) => r.id !== "agent" && r.id !== "machine");
}
