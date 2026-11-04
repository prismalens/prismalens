// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Sumit Patel

import { Link, useNavigate } from "@tanstack/react-router";
import { FolderGit2, Plus } from "lucide-react";
import { type FormEvent, useState } from "react";
import { Empty, Loading, Problem } from "@/components/shared/State";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { usePageTitle } from "@/hooks/use-page-title";
import {
	useAddRepositorySource,
	useRepositories,
} from "@/lib/api/hooks/use-repositories-orpc";
import { getErrorMessage } from "@/lib/get-error-message";

/** Every project: a folder or git URL, with or without a service (#1020). */
export function ProjectList() {
	usePageTitle("Projects");
	const repos = useRepositories({ limit: 100 });
	const add = useAddRepositorySource();
	const navigate = useNavigate();
	const [source, setSource] = useState("");
	const [error, setError] = useState<string | null>(null);

	const onAdd = async (e: FormEvent) => {
		e.preventDefault();
		if (!source.trim()) return;
		setError(null);
		try {
			const repo = await add.mutateAsync({ source: source.trim() });
			setSource("");
			await navigate({ to: "/projects/$id", params: { id: repo.id } });
		} catch (err) {
			setError(getErrorMessage(err));
		}
	};

	const rows = repos.data?.data ?? [];
	return (
		<div className="flex h-full flex-col bg-canvas" data-testid="projects-page">
			<header className="flex min-h-(--header-h) shrink-0 items-center gap-2 bg-surface-1 px-4">
				<h1 className="flex-1 text-title">Projects</h1>
			</header>
			<div className="min-h-0 flex-1 overflow-y-auto px-4 pb-6">
				<div className="mx-auto grid max-w-(--reading-w) gap-4 pt-4">
					<form
						onSubmit={(e) => void onAdd(e)}
						className="flex items-center gap-2"
						data-testid="add-project"
					>
						<Input
							value={source}
							onChange={(e) => setSource(e.target.value)}
							placeholder="Folder or git URL"
							aria-label="Folder or git URL"
							data-testid="add-project-source"
						/>
						<Button
							type="submit"
							disabled={!source.trim() || add.isPending}
							data-testid="add-project-submit"
						>
							<Plus />
							Add project
						</Button>
					</form>
					{error && (
						<p className="text-meta text-danger" role="alert">
							{error}
						</p>
					)}
					{repos.isLoading ? (
						<Loading rows={3} />
					) : repos.error ? (
						<Problem
							text={getErrorMessage(repos.error)}
							onRetry={() => void repos.refetch()}
						/>
					) : rows.length === 0 ? (
						<Empty text="No projects yet" />
					) : (
						<ul className="grid gap-1" data-testid="project-rows">
							{rows.map((r) => (
								<li key={r.id}>
									<Link
										to="/projects/$id"
										params={{ id: r.id }}
										className="flex h-10 items-center gap-2 rounded-control px-2 text-body text-text-1 hover:bg-surface-2"
										data-testid="project-row"
									>
										<FolderGit2 className="size-4 shrink-0 text-text-3" />
										<span className="min-w-0 flex-1 truncate">
											{r.fullName}
										</span>
										{r.syncBranch && (
											<span className="text-meta text-text-3">
												{r.syncBranch}
											</span>
										)}
									</Link>
								</li>
							))}
						</ul>
					)}
				</div>
			</div>
		</div>
	);
}
