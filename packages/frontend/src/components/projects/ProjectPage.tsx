// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Sumit Patel

import type { Investigation } from "@prismalens/contracts";
import { Link } from "@tanstack/react-router";
import { ChevronLeft, FolderGit2, MessageSquare, Server } from "lucide-react";
import { type FormEvent, useState } from "react";
import { TickDot } from "@/components/schedules/TickDot";
import { Empty, Loading, NotFound, Problem } from "@/components/shared/State";
import { NewThread } from "@/components/thread/NewThread";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { usePageTitle } from "@/hooks/use-page-title";
import {
	useLinkRepository,
	useRepository,
} from "@/lib/api/hooks/use-repositories-orpc";
import {
	useCreateService,
	useService,
} from "@/lib/api/hooks/use-services-orpc";
import { useThreads } from "@/lib/api/hooks/use-threads-orpc";
import { getErrorMessage } from "@/lib/get-error-message";

const TONE = {
	pending: "live",
	running: "live",
	completed: "ok",
	failed: "bad",
	cancelled: "muted",
} as const;

/**
 * A project's page (#1020): its name and code, a new thread on it, its threads,
 * and Make it a service. Thread titles are the user's own first lines, plain text.
 */
export function ProjectPage({ id }: { id: string }) {
	const repo = useRepository(id);
	const threads = useThreads({ repositoryId: id });
	usePageTitle(repo.data ? `${repo.data.fullName}, Projects` : "Projects");
	const back = (
		<Button variant="text" size="sm" asChild>
			<Link to="/projects">Back to projects</Link>
		</Button>
	);
	if (repo.isLoading) return <Loading />;
	if (repo.error || !repo.data) {
		const gone =
			!repo.error || (repo.error as { status?: number }).status === 404;
		return gone ? (
			<NotFound text="No project here." back={back} />
		) : (
			<Problem
				text={getErrorMessage(repo.error)}
				onRetry={() => void repo.refetch()}
				back={back}
			/>
		);
	}
	const p = repo.data;
	const linked = p.services ?? [];
	const rows = threads.data?.data ?? [];
	return (
		<div className="flex h-full flex-col bg-canvas" data-testid="project-page">
			<header className="flex min-h-(--header-h) shrink-0 items-center gap-2 bg-surface-1 py-1.5 pr-3 pl-2">
				<Button
					variant="ghost"
					size="icon-lg"
					aria-label="Back to projects"
					asChild
				>
					<Link to="/projects">
						<ChevronLeft />
					</Link>
				</Button>
				<FolderGit2 className="size-4 shrink-0 text-text-3" aria-hidden />
				<h1
					className="min-w-0 flex-1 truncate text-title"
					data-testid="project-name"
				>
					{p.fullName}
				</h1>
			</header>
			<div className="min-h-0 flex-1 overflow-y-auto px-4 pb-6">
				<div className="mx-auto grid max-w-(--reading-w) gap-5 pt-4">
					<section
						aria-label="Code"
						className="grid gap-1 rounded-pool bg-surface-2 px-3.5 py-3 text-body"
						data-testid="project-code"
					>
						<span className="truncate text-text-1">{p.url}</span>
						<span className="text-meta text-text-3">
							{p.syncError
								? p.syncError
								: [
										p.sourceKind === "folder" ? "Folder" : "Git URL",
										p.syncBranch,
										p.syncHead?.slice(0, 7),
									]
										.filter(Boolean)
										.join(" ")}
						</span>
					</section>
					<NewThread
						subject={{ kind: "project", repositoryId: id }}
						branch={p.syncBranch ?? p.defaultBranch}
					/>
					<section aria-label="Threads" data-testid="project-threads">
						<h2 className="mb-1.5 ml-1 text-heading text-text-2">Threads</h2>
						{threads.isLoading ? (
							<Loading rows={2} />
						) : threads.error ? (
							<Problem
								text={getErrorMessage(threads.error)}
								onRetry={() => void threads.refetch()}
							/>
						) : rows.length === 0 ? (
							<Empty text="No threads yet" />
						) : (
							<ul className="grid gap-1">
								{rows.map((t) => (
									<ThreadRow key={t.id} thread={t} />
								))}
							</ul>
						)}
					</section>
					<MakeService
						repositoryId={id}
						defaultName={p.fullName}
						linked={linked.map((s) => s.serviceId)}
					/>
				</div>
			</div>
		</div>
	);
}

function ThreadRow({ thread }: { thread: Investigation }) {
	return (
		<li>
			<Link
				to="/threads/$id"
				params={{ id: thread.id }}
				className="flex h-10 items-center gap-2 rounded-control px-2 text-body text-text-1 hover:bg-surface-2"
				data-testid="project-thread-row"
			>
				<MessageSquare className="size-4 shrink-0 text-text-3" />
				<span className="min-w-0 flex-1 truncate">
					{thread.title ?? "Thread"}
				</span>
				<TickDot tone={TONE[thread.status]} />
			</Link>
		</li>
	);
}

/**
 * Make it a service: a name only, the project's by default. Alerts reach it by the
 * existing `service=<name>` label rule, shown read-only (#1020, OBJ-007).
 */
function MakeService({
	repositoryId,
	defaultName,
	linked,
}: {
	repositoryId: string;
	defaultName: string;
	linked: string[];
}) {
	const create = useCreateService();
	const link = useLinkRepository();
	const service = useService(linked[0] ?? "");
	const [name, setName] = useState(defaultName);
	const [error, setError] = useState<string | null>(null);
	const first = linked[0];
	if (first) {
		const serviceName = service.data?.name;
		return (
			<section
				aria-label="Service"
				className="grid gap-1"
				data-testid="project-service"
			>
				<span className="flex items-center gap-2 text-body text-text-2">
					<Server className="size-4 shrink-0 text-text-3" aria-hidden />
					<Link
						to="/services/$id"
						params={{ id: first }}
						className="text-text-1 hover:underline"
					>
						Open service
					</Link>
				</span>
				{serviceName && (
					<p
						className="ml-6 font-mono text-meta text-text-3"
						data-testid="project-service-rule"
					>
						service={serviceName}
					</p>
				)}
			</section>
		);
	}
	const onMake = async (e: FormEvent) => {
		e.preventDefault();
		const n = name.trim();
		if (!n) return;
		setError(null);
		try {
			const service = await create.mutateAsync({ name: n });
			await link.mutateAsync({ id: repositoryId, serviceId: service.id });
		} catch (err) {
			setError(getErrorMessage(err));
		}
	};
	return (
		<section
			aria-label="Make it a service"
			className="grid gap-2"
			data-testid="make-service"
		>
			<h2 className="ml-1 text-heading text-text-2">Make it a service</h2>
			<form onSubmit={(e) => void onMake(e)} className="flex gap-2">
				<Input
					value={name}
					onChange={(e) => setName(e.target.value)}
					aria-label="Service name"
					data-testid="make-service-name"
				/>
				<Button
					type="submit"
					variant="secondary"
					disabled={!name.trim() || create.isPending || link.isPending}
					data-testid="make-service-submit"
				>
					Make service
				</Button>
			</form>
			<p className="ml-1 font-mono text-meta text-text-3">
				service={name.trim() || defaultName}
			</p>
			{error && (
				<p className="ml-1 text-meta text-danger" role="alert">
					{error}
				</p>
			)}
		</section>
	);
}
