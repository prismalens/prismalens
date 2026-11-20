// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Sumit Patel

import {
	PROJECT_SCRIPT_COMMAND_MAX,
	PROJECT_SCRIPT_NAME_MAX,
	runnableCommand,
} from "@prismalens/contracts";
import { Link } from "@tanstack/react-router";
import { useState } from "react";
import { Button } from "@/components/ui/button";
import {
	Dialog,
	DialogContent,
	DialogDescription,
	DialogFooter,
	DialogHeader,
	DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { useEditProjectScript } from "@/lib/api/hooks/use-project-scripts";
import { getErrorMessage } from "@/lib/get-error-message";

/** What is wrong with a script's fields, by field; empty when it can be saved. */
export function scriptErrors(
	name: string,
	command: string,
): { name?: string; command?: string } {
	const n = name.trim();
	return {
		...(!n
			? { name: "Name it" }
			: n.length > PROJECT_SCRIPT_NAME_MAX
				? { name: `At most ${PROJECT_SCRIPT_NAME_MAX} characters` }
				: {}),
		...(!command.trim()
			? { command: "Type a command" }
			: command.length > PROJECT_SCRIPT_COMMAND_MAX
				? { command: `At most ${PROJECT_SCRIPT_COMMAND_MAX} characters` }
				: !runnableCommand(command)
					? { command: "One line, no control characters" }
					: {}),
	};
}

/**
 * Add or edit one of a project's stored scripts (#1176). It is staged in a terminal and
 * run by the user's Enter, so the dialog asks for nothing about when it runs.
 */
export function ScriptDialog({
	projectId,
	script,
	onClose,
}: {
	projectId: string;
	/** The stored script to edit; absent adds one. */
	script?: { id: string; name: string; command: string };
	onClose: () => void;
}) {
	const [name, setName] = useState(script?.name ?? "");
	const [command, setCommand] = useState(script?.command ?? "");
	const [tried, setTried] = useState(false);
	const save = useEditProjectScript(projectId);
	const errors = tried ? scriptErrors(name, command) : {};
	const submit = () => {
		setTried(true);
		const e = scriptErrors(name, command);
		if (e.name || e.command) return;
		save.mutate(
			script
				? { op: "update", scriptId: script.id, name: name.trim(), command }
				: { op: "add", name: name.trim(), command },
			{ onSuccess: onClose },
		);
	};
	return (
		<Dialog open onOpenChange={(o) => !o && onClose()}>
			<DialogContent data-testid="script-dialog">
				<DialogHeader>
					<DialogTitle>{script ? "Edit script" : "Add script"}</DialogTitle>
					<DialogDescription>
						It goes to the terminal; you press Enter to run it. Worktree setup
						is in the{" "}
						<Link
							to="/settings"
							search={{ tab: "runs" }}
							className="text-accent hover:underline"
						>
							Runs settings
						</Link>
						.
					</DialogDescription>
				</DialogHeader>
				<form
					className="flex flex-col gap-3"
					onSubmit={(e) => {
						e.preventDefault();
						submit();
					}}
					noValidate
				>
					<div className="flex flex-col gap-1 text-meta text-text-2">
						<Label htmlFor="script-name">Name</Label>
						<Input
							id="script-name"
							value={name}
							onChange={(e) => setName(e.target.value)}
							aria-invalid={!!errors.name}
							data-testid="script-name"
							autoFocus
						/>
						{errors.name && (
							<span className="text-danger" data-testid="script-name-error">
								{errors.name}
							</span>
						)}
					</div>
					<div className="flex flex-col gap-1 text-meta text-text-2">
						<Label htmlFor="script-command">Command</Label>
						<Input
							id="script-command"
							value={command}
							onChange={(e) => setCommand(e.target.value)}
							aria-invalid={!!errors.command}
							data-testid="script-command"
						/>
						{errors.command && (
							<span className="text-danger" data-testid="script-command-error">
								{errors.command}
							</span>
						)}
					</div>
					{save.isError && (
						<p className="m-0 text-meta text-danger" data-testid="script-error">
							{getErrorMessage(save.error)}
						</p>
					)}
					<DialogFooter>
						<Button type="button" variant="text" onClick={onClose}>
							Cancel
						</Button>
						<Button
							type="submit"
							disabled={save.isPending}
							data-testid="script-save"
						>
							Save
						</Button>
					</DialogFooter>
				</form>
			</DialogContent>
		</Dialog>
	);
}
