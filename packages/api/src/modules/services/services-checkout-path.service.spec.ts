// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Sumit Patel

/**
 * Service → local checkout mapping (#331): the PERSISTENCE + REJECTION half.
 *
 * The point of validating at configuration time is that a bad path never
 * reaches the database, so these tests drive real directories (and a real
 * `git init`) through `ServicesService` and assert on what would be written.
 */
import { Test, type TestingModule } from "@nestjs/testing";
import { execFileSync } from "node:child_process";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { PrismaService } from "../../core/prisma/prisma.service.js";
import type { CreateServiceDto, UpdateServiceDto } from "./dto/index.js";
import {
	InvalidCheckoutPathError,
	ServicesService,
} from "./services.service.js";

const mockPrismaService = {
	service: {
		create: vi.fn(),
		update: vi.fn(),
		findUnique: vi.fn(),
		findMany: vi.fn(),
		count: vi.fn(),
		delete: vi.fn(),
	},
	serviceDependency: {
		create: vi.fn(),
		update: vi.fn(),
		delete: vi.fn(),
	},
	$transaction: vi.fn(),
};

let root: string;
let gitRepo: string;
let plainDir: string;
let regularFile: string;
let service: ServicesService;

beforeAll(() => {
	root = mkdtempSync(join(tmpdir(), "pl-331-api-"));
	gitRepo = join(root, "checkout");
	plainDir = join(root, "not-a-repo");
	regularFile = join(root, "a-file.txt");
	mkdirSync(gitRepo, { recursive: true });
	mkdirSync(plainDir, { recursive: true });
	writeFileSync(regularFile, "not a directory\n");
	execFileSync("git", ["init", "--quiet"], { cwd: gitRepo });
});

afterAll(() => {
	rmSync(root, { recursive: true, force: true });
});

beforeEach(async () => {
	vi.clearAllMocks();
	const module: TestingModule = await Test.createTestingModule({
		providers: [
			ServicesService,
			{ provide: PrismaService, useValue: mockPrismaService },
		],
	}).compile();
	service = module.get<ServicesService>(ServicesService);
});

describe("ServicesService — local checkout persistence (#331)", () => {
	it("round-trips a valid checkout: create stores the NORMALISED absolute path", async () => {
		mockPrismaService.service.create.mockResolvedValue({
			id: "svc-1",
			name: "checkout",
			localCheckoutPath: gitRepo,
		});

		const created = await service.create({
			name: "checkout",
			// Deliberately messy: trailing slash-dot and whitespace must not survive.
			localCheckoutPath: `  ${gitRepo}/.  `,
		} as CreateServiceDto);

		expect(mockPrismaService.service.create).toHaveBeenCalledWith(
			expect.objectContaining({
				data: expect.objectContaining({ localCheckoutPath: gitRepo }),
			}),
		);
		expect(created.localCheckoutPath).toBe(gitRepo);
	});

	it("update stores the mapping", async () => {
		mockPrismaService.service.update.mockResolvedValue({
			id: "svc-1",
			name: "checkout",
			localCheckoutPath: gitRepo,
		});

		await service.update("svc-1", {
			localCheckoutPath: gitRepo,
		} as UpdateServiceDto);

		expect(mockPrismaService.service.update).toHaveBeenCalledWith(
			expect.objectContaining({
				where: { id: "svc-1" },
				data: expect.objectContaining({ localCheckoutPath: gitRepo }),
			}),
		);
	});

	it("an empty string CLEARS the mapping rather than storing \"\"", async () => {
		mockPrismaService.service.update.mockResolvedValue({
			id: "svc-1",
			name: "checkout",
			localCheckoutPath: null,
		});

		await service.update("svc-1", {
			localCheckoutPath: "",
		} as UpdateServiceDto);

		expect(mockPrismaService.service.update).toHaveBeenCalledWith(
			expect.objectContaining({
				data: expect.objectContaining({ localCheckoutPath: null }),
			}),
		);
	});

	it("an update that does not mention the mapping leaves it untouched", async () => {
		mockPrismaService.service.update.mockResolvedValue({
			id: "svc-1",
			name: "checkout",
		});

		await service.update("svc-1", { team: "platform" } as UpdateServiceDto);

		const [[call]] = mockPrismaService.service.update.mock.calls;
		expect(call.data).not.toHaveProperty("localCheckoutPath");
	});
});

describe("ServicesService — a bad checkout never reaches the database (#331)", () => {
	const cases: Array<[string, () => string, string]> = [
		["a path that does not exist", () => join(root, "missing"), "not_found"],
		["a file", () => regularFile, "not_a_directory"],
		["a directory that is not a git checkout", () => plainDir, "not_a_git_repo"],
		["a relative path", () => "relative/path", "not_absolute"],
	];

	for (const [label, path, reason] of cases) {
		it(`create rejects ${label}`, async () => {
			await expect(
				service.create({
					name: "checkout",
					localCheckoutPath: path(),
				} as CreateServiceDto),
			).rejects.toBeInstanceOf(InvalidCheckoutPathError);
			expect(mockPrismaService.service.create).not.toHaveBeenCalled();
		});

		it(`update rejects ${label}, and the reason is ${reason}`, async () => {
			const error = await service
				.update("svc-1", { localCheckoutPath: path() } as UpdateServiceDto)
				.then(
					() => null,
					(e: unknown) => e as InvalidCheckoutPathError,
				);

			expect(error).toBeInstanceOf(InvalidCheckoutPathError);
			expect(error?.validation.reason).toBe(reason);
			// The message is rendered verbatim in the UI — it must say something.
			expect(error?.message.length).toBeGreaterThan(0);
			expect(mockPrismaService.service.update).not.toHaveBeenCalled();
		});
	}
});

describe("ServicesService.validateCheckoutPath (#331)", () => {
	it("reports a valid checkout without writing anything", async () => {
		const result = await service.validateCheckoutPath(gitRepo);
		expect(result.valid).toBe(true);
		expect(result.path).toBe(gitRepo);
		expect(mockPrismaService.service.update).not.toHaveBeenCalled();
		expect(mockPrismaService.service.create).not.toHaveBeenCalled();
	});

	it("reports an invalid checkout with an actionable reason", async () => {
		const result = await service.validateCheckoutPath(plainDir);
		expect(result.valid).toBe(false);
		expect(result.reason).toBe("not_a_git_repo");
		expect(result.message).toContain(plainDir);
	});
});
