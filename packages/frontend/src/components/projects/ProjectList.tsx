// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Sumit Patel

import { projectKindOf } from "@prismalens/contracts";
import { Link, useNavigate } from "@tanstack/react-router";
import { Plus } from "lucide-react";
import { useEffect, useState } from "react";
import { ProjectMark } from "@/components/shared/ProjectMark";
import { Empty, Loading, Problem } from "@/components/shared/State";
import { Button } from "@/components/ui/button";
import { usePageTitle } from "@/hooks/use-page-title";
import {
	useAddRepositorySource,
	useRepositories,
} from "@/lib/api/hooks/use-repositories-orpc";
import { getErrorMessage } from "@/lib/get-error-message";
import { KIND_ICON, KIND_WORD } from "@/lib/project-source";
import { AddProjectDialog } from "./AddProjectDialog";

/** Every project: a folder or git URL, with or without a service (#1020). */
export function ProjectList({ add: openAtStart = false }: { add?: boolean }) {
	usePageTitle("Projects");
	const repos = useRepositories({ limit: 100 });
	const add = useAddRepositorySource();
	const navigate = useNavigate();
	const [open, setOpen] = useState(openAtStart);
	useEffect(() => {
		if (openAtStart) setOpen(true);
	}, [openAtStart]);
	const [error, setError] = useState<string | null>(null);

	const onAdd = async (source: string) => {
		setError(null);
		try {
			const repo = await add.mutateAsync({ source });
			setOpen(false);
			await navigate({ to: "/projects/$id", params: { id: repo.id } });
		} catch (err) {
			setError(getErrorMessage(err));
		}
	};

	const rows = repos.data?.data ?? [];
	return (
		<div className="flex h-full flex-col bg-canvas" data-testid="projects-page">
			<header
				data-title-row
				className="flex min-h-(--header-h) shrink-0 items-center gap-2 bg-surface-1 px-4"
			>
				<h1 className="flex-1 text-title">Projects</h1>
				<Button onClick={() => setOpen(true)} data-testid="add-project">
					<Plus />
					Add project
				</Button>
			</header>
			{open && (
				<AddProjectDialog
					open
					onOpenChange={(o) => {
						setOpen(o);
						setError(null);
						if (!o && openAtStart)
							void navigate({ to: "/projects", search: {}, replace: true });
					}}
					onChoose={(s) => void onAdd(s)}
					pending={add.isPending}
					error={error}
				/>
			)}
			<div className="min-h-0 flex-1 overflow-y-auto px-4 pb-6">
				<div className="mx-auto grid max-w-(--reading-w) gap-4 pt-4">
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
										<ProjectMark
											name={r.fullName}
											iconUrl={r.iconUrl}
											size="sm"
										/>
										<span className="min-w-0 flex-1 truncate">
											{r.fullName}
										</span>
										{r.syncBranch && (
											<span className="text-meta text-text-3">
												{r.syncBranch}
											</span>
										)}
										<KindMark kind={projectKindOf(r)} />
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

/** A project's kind as its icon and word (#1020). */
export function KindMark({
	kind,
	className,
}: {
	kind: ReturnType<typeof projectKindOf>;
	className?: string;
}) {
	const Icon = KIND_ICON[kind];
	return (
		<span
			className={
				className ?? "flex shrink-0 items-center gap-1.5 text-meta text-text-3"
			}
			data-testid="project-kind"
			data-kind={kind}
		>
			<Icon className="size-4 shrink-0" aria-hidden />
			<span>{KIND_WORD[kind]}</span>
		</span>
	);
}
