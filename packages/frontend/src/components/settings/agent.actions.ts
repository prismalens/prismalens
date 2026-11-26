// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Sumit Patel

import { ArrowUpCircle, LogOut, RefreshCw, UserRoundCog } from "lucide-react";
import {
	defineAction,
	defineObject,
	type Facts,
} from "@/components/kit/actions";

/**
 * An agent in Settings → Agents (#1180): its own CLI's lines, each staged in a fresh
 * terminal, and the list's Update all. A fact is on only while its line exists.
 */
export interface AgentCtx {
	update: () => void;
	signOut: () => void;
	changeAccount: () => void;
	updateAll: () => void;
	facts: Facts<
		"canUpdate" | "canSignOut" | "canChangeAccount" | "canUpdateAll"
	>;
}

export const agentObject = defineObject<
	AgentCtx,
	"canUpdate" | "canSignOut" | "canChangeAccount" | "canUpdateAll"
>("agent");

export const agentUpdate = defineAction({
	id: "agent.update",
	label: "Update",
	icon: ArrowUpCircle,
	when: (f) => !!f.is?.canUpdate,
	run: (c) => c.update(),
});

export const agentChangeAccount = defineAction({
	id: "agent.changeAccount",
	label: "Change account",
	icon: UserRoundCog,
	when: (f) => !!f.is?.canChangeAccount,
	run: (c) => c.changeAccount(),
});

export const agentSignOut = defineAction({
	id: "agent.signOut",
	label: "Sign out",
	icon: LogOut,
	when: (f) => !!f.is?.canSignOut,
	run: (c) => c.signOut(),
});

export const agentUpdateAll = defineAction({
	id: "agent.updateAll",
	label: "Update all",
	icon: RefreshCw,
	when: (f) => !!f.is?.canUpdateAll,
	run: (c) => c.updateAll(),
});
