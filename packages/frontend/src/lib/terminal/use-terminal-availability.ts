// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Sumit Patel

import type { TerminalAvailability } from "@prismalens/contracts";
import { useQuery } from "@tanstack/react-query";
import { useSyncExternalStore } from "react";
import { PHONE, useMediaQuery } from "@/hooks/use-media-query";
import { orpc } from "@/lib/api/orpc-client";
import { subscribeTerminalKey, terminalKey } from "./key";

const PHONE_ANSWER: TerminalAvailability = {
	available: false,
	reason: "not-host",
};

/** The availability check itself: its answer, whether it failed, and a retry (#1101 bar 21.2). */
export function useTerminalCheck(): {
	availability: TerminalAvailability | undefined;
	failed: boolean;
	retry: () => void;
} {
	const phone = useMediaQuery(PHONE);
	const key = useSyncExternalStore(subscribeTerminalKey, terminalKey);
	const query = useQuery({
		...orpc.terminal.availability.queryOptions({
			input: { key },
		}),
		enabled: !phone,
		staleTime: 60_000,
		retry: false,
	});
	return {
		availability: phone ? PHONE_ANSWER : query.data,
		failed: !phone && query.isError && !query.data,
		retry: () => void query.refetch(),
	};
}

/**
 * Whether this client may open a terminal. A phone never asks: it is always
 * a paired device (#859), so it gets Copy only.
 */
export function useTerminalAvailability(): TerminalAvailability | undefined {
	return useTerminalCheck().availability;
}
