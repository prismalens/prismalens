// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Sumit Patel

import { useState } from "react";
import { useAddRepositorySource } from "@/lib/api/hooks/use-repositories-orpc";
import { getErrorMessage } from "@/lib/get-error-message";
import { AddProjectDialog } from "./AddProjectDialog";

/** The Add project dialog with its mutation: the caller learns the new project's id and decides where to go. */
export function AddProjectFlow({
	onOpenChange,
	onAdded,
}: {
	onOpenChange: (open: boolean) => void;
	onAdded: (repositoryId: string) => void;
}) {
	const add = useAddRepositorySource();
	const [error, setError] = useState<string | null>(null);
	return (
		<AddProjectDialog
			open
			onOpenChange={(o) => {
				setError(null);
				onOpenChange(o);
			}}
			onChoose={(source) => {
				setError(null);
				return add.mutateAsync({ source }).then(
					(repo) => onAdded(repo.id),
					(err) => {
						setError(getErrorMessage(err));
						throw err;
					},
				);
			}}
			pending={add.isPending}
			error={error}
		/>
	);
}
