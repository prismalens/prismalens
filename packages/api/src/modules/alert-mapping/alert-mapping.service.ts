// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Sumit Patel

import { Injectable, Logger } from "@nestjs/common";
import type { Repository, Service } from "@prismalens/database";
import { PrismaService } from "../../core/prisma/prisma.service.js";

export interface AlertInfo {
	source?: string;
	labels?: Record<string, string>;
	/** The webhook's `serviceName` field: counts exactly like the `service` label. */
	serviceName?: string;
	tags?: string[];
	title: string;
	description?: string;
}

const lastSegment = (name: string) => name.split("/").pop() ?? name;

/**
 * Intake's one service lookup (#1008 N4). The name an alert carries, from its
 * `serviceName` field or its `service` label, matches a `Service.name` exactly;
 * failing that it matches a project (a git repository the user added), whose
 * service is made on first use. An alert that names nothing goes to the
 * workspace's only project, if there is exactly one. A name that matches
 * nothing stays unrouted: a typo must not land on the wrong code.
 */
@Injectable()
export class AlertMappingService {
	private readonly logger = new Logger(AlertMappingService.name);
	/** The service being made for a project: alerts that arrive meanwhile await it instead of racing it. */
	private readonly making = new Map<string, Promise<Service>>();

	constructor(private readonly prisma: PrismaService) {}

	async resolveServiceForAlert(alert: AlertInfo): Promise<Service | null> {
		// A stored service name may carry spaces (the contract allows it): look it up as sent, then trimmed.
		const raw = [alert.serviceName, alert.labels?.service].filter(
			(n): n is string => !!n?.trim(),
		);
		const names = raw.map((n) => n.trim());

		for (const name of new Set(raw.flatMap((n) => [n, n.trim()]))) {
			const service = await this.prisma.service.findUnique({ where: { name } });
			if (service) {
				this.logger.debug(
					`Alert "${alert.title}" mapped to service "${service.name}" by exact name match`,
				);
				return service;
			}
		}
		if (names.length > 0) {
			for (const name of names) {
				const project = await this.projectNamed(name);
				if (project) return this.serviceOf(project);
			}
			this.logger.debug(
				`Alert "${alert.title}" names "${names.join('", "')}" but no service or project has that name`,
			);
			return null;
		}

		const projects = await this.prisma.repository.findMany({
			where: { plain: false },
			take: 2,
			orderBy: { createdAt: "asc" },
		});
		const only = projects.length === 1 ? projects[0] : undefined;
		if (!only) return null;
		// Another service already in the workspace means the user routes by name.
		const services = await this.prisma.service.count();
		const linked = await this.prisma.serviceRepository.count({
			where: { repositoryId: only.id },
		});
		if (services > 0 && linked === 0) return null;
		return this.serviceOf(only);
	}

	private async projectNamed(name: string): Promise<Repository | null> {
		const wanted = name.toLowerCase();
		const projects = await this.prisma.repository.findMany({
			where: { plain: false },
		});
		const exact = projects.filter((p) => p.fullName.toLowerCase() === wanted);
		const found =
			exact.length > 0
				? exact
				: projects.filter(
						(p) => lastSegment(p.fullName).toLowerCase() === wanted,
					);
		// Two projects that share a folder name are ambiguous: route neither.
		return found.length === 1 ? (found[0] ?? null) : null;
	}

	/**
	 * The project's primary service; made when it has none. A service is reused
	 * only through a repository link: a same-named service of another project is
	 * not this project's, so the new one takes a name no service holds.
	 */
	private async serviceOf(project: Repository): Promise<Service> {
		const linked = await this.linkedService(project.id);
		if (linked) return linked;
		const running = this.making.get(project.id);
		if (running) return running;
		const made = this.makeOrTakeService(project).finally(() =>
			this.making.delete(project.id),
		);
		this.making.set(project.id, made);
		return made;
	}

	private async makeOrTakeService(project: Repository): Promise<Service> {
		try {
			return await this.makeLinkedService(project);
		} catch (error) {
			if ((error as { code?: string }).code !== "P2002") throw error;
			// A concurrent first alert for this project won the unique name or link: take its service, or retry once.
			return (
				(await this.linkedService(project.id)) ??
				(await this.makeLinkedService(project))
			);
		}
	}

	private async linkedService(repositoryId: string): Promise<Service | null> {
		const link = await this.prisma.serviceRepository.findFirst({
			where: { repositoryId },
			orderBy: { isPrimary: "desc" },
			include: { service: true },
		});
		return link?.service ?? null;
	}

	private async makeLinkedService(project: Repository): Promise<Service> {
		const service = await this.prisma.$transaction(async (tx) => {
			const taken = await tx.serviceRepository.findFirst({
				where: { repositoryId: project.id },
				include: { service: true },
			});
			if (taken) return taken.service;
			const name = await this.freeServiceName(tx, project);
			const made = await tx.service.create({ data: { name } });
			await tx.serviceRepository.create({
				data: {
					serviceId: made.id,
					repositoryId: project.id,
					subPath: project.subPath,
					isPrimary: true,
				},
			});
			return made;
		});
		this.logger.log(
			`Project ${project.fullName} became service "${service.name}" because an alert reached it`,
		);
		return service;
	}

	/** The project's folder name, else its full name, else the full name numbered. */
	private async freeServiceName(
		tx: Pick<PrismaService, "service">,
		project: Repository,
	): Promise<string> {
		const base = lastSegment(project.fullName);
		for (const name of [base, project.fullName]) {
			if (!(await tx.service.findUnique({ where: { name } }))) return name;
		}
		for (let n = 2; ; n++) {
			const name = `${project.fullName}-${n}`;
			if (!(await tx.service.findUnique({ where: { name } }))) return name;
		}
	}
}
