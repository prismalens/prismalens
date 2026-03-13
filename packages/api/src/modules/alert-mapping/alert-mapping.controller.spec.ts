import { Logger } from '@nestjs/common';
import { Test, type TestingModule } from '@nestjs/testing';
import { AlertMappingController } from './alert-mapping.controller.js';
import { AlertMappingService } from './alert-mapping.service.js';
import type {
  CreateMappingRuleDto,
  UpdateMappingRuleDto,
} from './dto/index.js';

const mockAlertMappingService = {
  create: jest.fn(),
  findAll: jest.fn(),
  findById: jest.fn(),
  update: jest.fn(),
  delete: jest.fn(),
  resolveServiceForAlert: jest.fn(),
};

describe('AlertMappingController (BDD)', () => {
  let controller: AlertMappingController;
  let service: AlertMappingService;

  beforeEach(async () => {
    jest.clearAllMocks();
    jest.spyOn(Logger.prototype, 'log').mockImplementation(() => {});

    const module: TestingModule = await Test.createTestingModule({
      controllers: [AlertMappingController],
      providers: [
        { provide: AlertMappingService, useValue: mockAlertMappingService },
      ],
    }).compile();

    controller = module.get<AlertMappingController>(AlertMappingController);
    service = module.get<AlertMappingService>(AlertMappingService);
  });

  // Unwrap oRPC ImplementedProcedure objects: each value is a DecoratedProcedure
  // whose actual handler function lives at ['~orpc'].handler
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  function getHandlers(): any {
    const procedures = controller.alertMapping() as Record<string, any>;
    return Object.fromEntries(
      Object.entries(procedures).map(([key, proc]) => [
        key,
        proc?.['~orpc']?.handler ?? proc,
      ]),
    );
  }

  describe('create', () => {
    it('should create a new mapping rule', async () => {
      const createDto: CreateMappingRuleDto = {
        name: 'Test Rule',
        serviceId: 'service-123',
        matchCriteria: { source: 'prometheus' },
        priority: 10,
        enabled: true,
      };

      const expectedRule = {
        id: 'rule-123',
        name: createDto.name,
        serviceId: createDto.serviceId,
        matchCriteria: JSON.stringify(createDto.matchCriteria),
        priority: 10,
        enabled: true,
        description: null,
        createdAt: new Date(),
        updatedAt: new Date(),
      };

      mockAlertMappingService.create.mockResolvedValue(expectedRule);

      const handlers = getHandlers();
      const result = await handlers.create({
        input: createDto,
      } as any);

      expect(result).toBeDefined();
      expect(service.create).toHaveBeenCalledWith(createDto);
    });

    it('should log rule creation', async () => {
      const createDto: CreateMappingRuleDto = {
        name: 'Test Rule',
        serviceId: 'service-123',
        matchCriteria: { source: 'prometheus' },
      };

      mockAlertMappingService.create.mockResolvedValue({
        id: 'rule-123',
        name: createDto.name,
        serviceId: createDto.serviceId,
        matchCriteria: JSON.stringify(createDto.matchCriteria),
        priority: 100,
        enabled: true,
        description: null,
        createdAt: new Date(),
        updatedAt: new Date(),
      });

      const handlers = getHandlers();
      await handlers.create({ input: createDto } as any);

      expect(Logger.prototype.log).toHaveBeenCalledWith(
        expect.stringContaining('Creating alert mapping rule'),
      );
    });
  });

  describe('list', () => {
    it('should return all mapping rules', async () => {
      const rules = [
        {
          id: 'rule-1',
          name: 'Rule 1',
          enabled: true,
          priority: 1,
          matchCriteria: '{}',
          serviceId: 'service-1',
          description: null,
          createdAt: new Date(),
          updatedAt: new Date(),
        },
        {
          id: 'rule-2',
          name: 'Rule 2',
          enabled: true,
          priority: 2,
          matchCriteria: '{}',
          serviceId: 'service-2',
          description: null,
          createdAt: new Date(),
          updatedAt: new Date(),
        },
      ];

      mockAlertMappingService.findAll.mockResolvedValue(rules);

      const handlers = getHandlers();
      const result = await handlers.list({} as any);

      expect(result).toHaveLength(2);
      expect(service.findAll).toHaveBeenCalled();
    });

    it('should return empty list when no rules exist', async () => {
      mockAlertMappingService.findAll.mockResolvedValue([]);

      const handlers = getHandlers();
      const result = await handlers.list({} as any);

      expect(result).toEqual([]);
    });
  });

  describe('get', () => {
    it('should return rule by id', async () => {
      const ruleId = 'rule-123';
      const expectedRule = {
        id: ruleId,
        name: 'Test Rule',
        enabled: true,
        priority: 1,
        matchCriteria: '{}',
        serviceId: 'service-1',
        description: null,
        createdAt: new Date(),
        updatedAt: new Date(),
      };

      mockAlertMappingService.findById.mockResolvedValue(expectedRule);

      const handlers = getHandlers();
      const result = await handlers.get({
        input: { id: ruleId },
      } as any);

      expect(result).toBeDefined();
      expect(service.findById).toHaveBeenCalledWith(ruleId);
    });

    it('should throw when rule not found', async () => {
      mockAlertMappingService.findById.mockResolvedValue(null);

      const handlers = getHandlers();

      await expect(
        handlers.get({ input: { id: 'non-existent' } } as any),
      ).rejects.toThrow();
    });
  });

  describe('update', () => {
    it('should update a mapping rule', async () => {
      const ruleId = 'rule-123';
      const updateDto: UpdateMappingRuleDto = {
        name: 'Updated Name',
        priority: 50,
      };

      const updatedRule = {
        id: ruleId,
        name: 'Updated Name',
        enabled: true,
        priority: 50,
        matchCriteria: '{}',
        serviceId: 'service-1',
        description: null,
        createdAt: new Date(),
        updatedAt: new Date(),
      };

      mockAlertMappingService.update.mockResolvedValue(updatedRule);

      const handlers = getHandlers();
      const result = await handlers.update({
        input: { id: ruleId, ...updateDto },
      } as any);

      expect(result).toBeDefined();
      expect(service.update).toHaveBeenCalledWith(ruleId, updateDto);
    });

    it('should log rule update', async () => {
      const ruleId = 'rule-123';
      const updateDto: UpdateMappingRuleDto = { name: 'Updated' };

      mockAlertMappingService.update.mockResolvedValue({
        id: ruleId,
        name: updateDto.name,
        enabled: true,
        priority: 1,
        matchCriteria: '{}',
        serviceId: 'service-1',
        description: null,
        createdAt: new Date(),
        updatedAt: new Date(),
      });

      const handlers = getHandlers();
      await handlers.update({
        input: { id: ruleId, ...updateDto },
      } as any);

      expect(Logger.prototype.log).toHaveBeenCalledWith(
        expect.stringContaining('Updating alert mapping rule'),
      );
    });
  });

  describe('delete', () => {
    it('should delete a mapping rule', async () => {
      const ruleId = 'rule-123';
      mockAlertMappingService.delete.mockResolvedValue(undefined);

      const handlers = getHandlers();
      await handlers.delete({ input: { id: ruleId } } as any);

      expect(service.delete).toHaveBeenCalledWith(ruleId);
    });

    it('should log rule deletion', async () => {
      const ruleId = 'rule-123';
      mockAlertMappingService.delete.mockResolvedValue(undefined);

      const handlers = getHandlers();
      await handlers.delete({ input: { id: ruleId } } as any);

      expect(Logger.prototype.log).toHaveBeenCalledWith(
        expect.stringContaining('Deleting alert mapping rule'),
      );
    });
  });

  describe('test', () => {
    it('should test alert mapping and return matched result', async () => {
      const alertData = {
        source: 'prometheus',
        title: 'Test Alert',
        labels: { env: 'prod' },
      };

      const matchedService = {
        id: 'service-1',
        name: 'API Service',
        createdAt: new Date(),
        updatedAt: new Date(),
        discoverySource: null,
        discoveryPath: null,
      };

      mockAlertMappingService.resolveServiceForAlert.mockResolvedValue(
        matchedService,
      );

      const handlers = getHandlers();
      const result = await handlers.test({
        input: { alertData },
      } as any);

      expect(result).toEqual({
        matchedRule: null,
        serviceId: matchedService.id,
        serviceName: matchedService.name,
      });
      expect(service.resolveServiceForAlert).toHaveBeenCalledWith(
        expect.objectContaining({
          source: 'prometheus',
          title: 'Test Alert',
          labels: { env: 'prod' },
        }),
      );
    });

    it('should return unmatched result when no service found', async () => {
      const alertData = {
        source: 'prometheus',
        title: 'Test Alert',
        labels: { env: 'dev' },
      };

      mockAlertMappingService.resolveServiceForAlert.mockResolvedValue(null);

      const handlers = getHandlers();
      const result = await handlers.test({
        input: { alertData },
      } as any);

      expect(result).toEqual({
        matchedRule: null,
        serviceId: null,
        serviceName: null,
      });
    });

    it('should log test mapping request', async () => {
      const alertData = {
        source: 'prometheus',
        title: 'Test Alert',
      };

      mockAlertMappingService.resolveServiceForAlert.mockResolvedValue(null);

      const handlers = getHandlers();
      await handlers.test({ input: { alertData } } as any);

      expect(Logger.prototype.log).toHaveBeenCalledWith(
        expect.stringContaining('Testing mapping for alert'),
      );
    });

    it('should handle all optional fields in test mapping', async () => {
      const alertData = {
        source: 'prometheus',
        title: 'Test Alert',
        description: 'Test description',
        labels: { env: 'prod', region: 'us-east' },
        tags: ['critical', 'database'],
      };

      mockAlertMappingService.resolveServiceForAlert.mockResolvedValue(null);

      const handlers = getHandlers();
      await handlers.test({ input: { alertData } } as any);

      expect(service.resolveServiceForAlert).toHaveBeenCalledWith(
        expect.objectContaining({
          source: 'prometheus',
          title: 'Test Alert',
          description: 'Test description',
          labels: alertData.labels,
          tags: alertData.tags,
        }),
      );
    });
  });
});
