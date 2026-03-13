import {
  IsArray,
  IsBoolean,
  IsEnum,
  IsNotEmpty,
  IsObject,
  IsOptional,
  IsString,
} from 'class-validator';
import { ServiceTier, ServiceType } from '../../../shared/enums/index.js';

/**
 * DTO for creating a service in the catalog
 */
export class CreateServiceDto {
  /** Unique service identifier (e.g., 'api-gateway', 'user-service') */
  @IsString()
  @IsNotEmpty()
  name!: string;

  /** Human-readable display name */
  @IsOptional()
  @IsString()
  displayName?: string;

  /** Service description */
  @IsOptional()
  @IsString()
  description?: string;

  /** Service type: service, database, queue, cache, gateway, external, infrastructure */
  @IsOptional()
  @IsEnum(ServiceType)
  type?: ServiceType;

  /** Service tier for prioritization: tier_1, tier_2, tier_3, tier_4 */
  @IsOptional()
  @IsEnum(ServiceTier)
  tier?: ServiceTier;

  /** Owning team */
  @IsOptional()
  @IsString()
  team?: string;

  /** Slack channel for alerts */
  @IsOptional()
  @IsString()
  slackChannel?: string;

  /** GitHub repository for AI code analysis */
  @IsOptional()
  @IsString()
  repository?: string;

  /** Tags for categorization */
  @IsOptional()
  @IsArray()
  @IsString({ each: true })
  tags?: string[];

  /** Additional metadata (runbook URL, oncall info, etc.) */
  @IsOptional()
  @IsObject()
  metadata?: Record<string, unknown>;

  /** Discovery source provider (e.g., 'github', 'gitlab') */
  @IsOptional()
  @IsString()
  discoverySource?: string;

  /** Discovery metadata (repository, importedAt, connectionId, etc.) */
  @IsOptional()
  @IsObject()
  discoveryMetadata?: Record<string, unknown>;

  /** Whether this service was created via discovery/import */
  @IsOptional()
  @IsBoolean()
  isDiscovered?: boolean;
}
