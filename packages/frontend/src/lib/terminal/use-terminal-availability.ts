// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Sumit Patel

import type { TerminalAvailability } from "@prismalens/contracts";
import { useQuery } from "@tanstack/react-query";
import { PHONE, useMediaQuery } from "@/hooks/use-media-query";
import { orpc } from "@/lib/api/orpc-client";
import { terminalKey } from "./key";

const PHONE_ANSWER: TerminalAvailability = {
	available: false,
	reason: "not-host",
};

/**
 * Whether this client may open a terminal. A phone never asks: it is always
 * a paired device (#859), so it gets Copy only.
 */
export function useTerminalAvailability(): TerminalAvailability | undefined {
	const phone = useMediaQuery(PHONE);
	const query = useQuery({
		...orpc.terminal.availability.queryOptions({
			input: { key: terminalKey() },
		}),
		enabled: !phone,
		staleTime: 60_000,
		retry: false,
	});
	return phone ? PHONE_ANSWER : query.data;
}
