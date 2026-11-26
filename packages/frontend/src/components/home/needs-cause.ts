// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Sumit Patel

import { failureWords } from "@/lib/failure-words";
import type { ListNode } from "@/lib/thread-list";

/** What stopped a thread: a provider or host stop. */
export const stopOf = (n: ListNode) =>
	n.info.mode ?? n.info.host ?? n.thread.limit?.mode ?? null;

/** The cause the status registry's `fix` reads: a stop, or a signed-out agent's failure. */
export const causeOf = (n: ListNode) =>
	stopOf(n) ??
	(n.info.status === "failed" &&
	n.thread.error &&
	failureWords(n.thread.error).signIn
		? "sign_in"
		: null);
