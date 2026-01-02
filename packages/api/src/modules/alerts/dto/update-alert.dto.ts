import {
  IsString,
  IsOptional,
  IsEnum,
  IsArray,
} from 'class-validator';
import { Severity, AlertStatus } from '../../../shared/enums/index.js';

/**
 * DTO for updating an alert
 */
export class UpdateAlertDto {
  @IsOptional()
  @IsString()
  title?: string;

  @IsOptional()
  @IsString()
  description?: string;

  @IsOptional()
  @IsEnum(Severity)
  severity?: Severity;

  @IsOptional()
  @IsEnum(AlertStatus)
  status?: AlertStatus;

  @IsOptional()
  @IsArray()
  @IsString({ each: true })
  tags?: string[];

  @IsOptional()
  @IsString()
  serviceId?: string;
}
