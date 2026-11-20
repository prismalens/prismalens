// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Sumit Patel

import { useMutation, useQueryClient } from "@tanstack/react-query";
import { orpc } from "../orpc-client";

export type ScriptChange =
	| { op: "add"; name: string; command: string }
	| { op: "update"; scriptId: string; name: string; command: string }
	| { op: "remove"; scriptId: string };

/** Add, change or remove a project's stored script (#1176); the panel and the project read it again. */
export function useEditProjectScript(projectId: string) {
	const queryClient = useQueryClient();
	return useMutation({
		mutationFn: (c: ScriptChange) =>
			c.op === "add"
				? orpc.repositories.addScript.call({
						id: projectId,
						name: c.name,
						command: c.command,
					})
				: c.op === "update"
					? orpc.repositories.updateScript.call({
							id: projectId,
							scriptId: c.scriptId,
							name: c.name,
							command: c.command,
						})
					: orpc.repositories.removeScript.call({
							id: projectId,
							scriptId: c.scriptId,
						}),
		onSuccess: () =>
			Promise.all([
				queryClient.invalidateQueries({ queryKey: orpc.threads.context.key() }),
				queryClient.invalidateQueries({
					queryKey: orpc.repositories.scripts.key(),
				}),
			]),
	});
}
