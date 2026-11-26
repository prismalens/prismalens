// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Sumit Patel

import { RefreshCw } from "lucide-react";
import { defineObject, type Facts } from "@/components/kit/actions";
import { define } from "@/registry/define";

/** The agents list in Settings → Agents. */
export interface AgentCtx {
	checkAll: () => void;
	facts: Facts<"checking" | "nothingToCheck">;
}

/** The agent object: the context its actions run with. */
export const agentObject = defineObject<
	AgentCtx,
	"checking" | "nothingToCheck"
>("agent");

/** Checks every installed agent that is on whose check runs isolated (#1180 §1.4). */
export const agentCheckAll = define.action({
	id: "agent.checkAll",
	label: "Check all",
	icon: RefreshCw,
	disabled: (f) => !!f.is?.checking || !!f.is?.nothingToCheck,
	run: (c) => c.checkAll(),
});
