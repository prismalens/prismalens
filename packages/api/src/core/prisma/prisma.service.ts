import {
  Injectable,
  Logger,
  OnModuleDestroy,
  OnModuleInit,
} from '@nestjs/common';
import { prisma } from '@prismalens/database';

@Injectable()
export class PrismaService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(PrismaService.name);

  // Expose the prisma instance methods
  get $connect() {
    return prisma.$connect.bind(prisma);
  }

  get $disconnect() {
    return prisma.$disconnect.bind(prisma);
  }

  get $transaction() {
    return prisma.$transaction.bind(prisma);
  }

  // Forward all Prisma model access
  get user() {
    return prisma.user;
  }

  get alert() {
    return prisma.alert;
  }

  get recommendation() {
    return prisma.recommendation;
  }

  get investigation() {
    return prisma.investigation;
  }

  get incident() {
    return prisma.incident;
  }

  get service() {
    return prisma.service;
  }

  get integration() {
    return prisma.integration;
  }

  get connection() {
    return prisma.connection;
  }

  get oAuthState() {
    return prisma.oAuthState;
  }

  get serviceIntegration() {
    return prisma.serviceIntegration;
  }

  get agentExecution() {
    return prisma.agentExecution;
  }

  get toolExecution() {
    return prisma.toolExecution;
  }

  get event() {
    return prisma.event;
  }

  get timelineEntry() {
    return prisma.timelineEntry;
  }

  get correlationRule() {
    return prisma.correlationRule;
  }

  get alertMappingRule() {
    return prisma.alertMappingRule;
  }

  get serviceDependency() {
    return prisma.serviceDependency;
  }

  get serviceSuggestion() {
    return prisma.serviceSuggestion;
  }

  get setting() {
    return prisma.setting;
  }

  get postmortem() {
    return prisma.postmortem;
  }

  get changeEvent() {
    return prisma.changeEvent;
  }

  // Better Auth models
  get session() {
    return prisma.session;
  }

  get account() {
    return prisma.account;
  }

  get verification() {
    return prisma.verification;
  }

  get organization() {
    return prisma.organization;
  }

  get member() {
    return prisma.member;
  }

  get invitation() {
    return prisma.invitation;
  }

  async onModuleInit(): Promise<void> {
    try {
      await prisma.$connect();
      this.logger.log('Database connection established');
    } catch (error) {
      this.logger.error('Database connection failed!');
      this.logger.error('Run "pnpm db:init" to initialize the database');
      throw error;
    }
  }

  async onModuleDestroy(): Promise<void> {
    await prisma.$disconnect();
    this.logger.log('Database connection closed');
  }
}
