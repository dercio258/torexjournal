import { Type } from 'class-transformer';
import {
    ArrayMaxSize,
    IsArray,
    IsBoolean,
    IsNumber,
    IsObject,
    IsOptional,
    IsString,
    Max,
    MaxLength,
    Min,
} from 'class-validator';

export class RegisterWorkerDto {
    @IsString()
    @MaxLength(120)
    workerId: string;

    @Type(() => Number)
    @IsNumber()
    @Min(1)
    @Max(1000)
    capacity: number;

    @IsOptional()
    @IsObject()
    systemInfo?: Record<string, any>;
}

export class AckWorkerTaskDto {
    @IsOptional()
    @IsString()
    @MaxLength(120)
    taskId?: string;

    @IsString()
    @MaxLength(40)
    status: string;

    @IsOptional()
    @IsString()
    @MaxLength(2000)
    message?: string;

    @IsOptional()
    @IsObject()
    details?: Record<string, any>;
}

export class ExchangeCredentialsDto {
    @IsString()
    @MaxLength(120)
    taskId: string;

    @Type(() => Number)
    @IsNumber()
    accountId: number;

    @IsString()
    @MaxLength(256)
    credentialToken: string;
}

export class SyncWorkerTradesDto {
    @Type(() => Number)
    @IsNumber()
    accountId: number;

    @IsOptional()
    @IsString()
    @MaxLength(32)
    login?: string;

    @IsOptional()
    @IsString()
    @MaxLength(120)
    server?: string;

    @IsOptional()
    @Type(() => Number)
    @IsNumber()
    serverTzOffsetSec?: number;

    @IsOptional()
    @IsArray()
    @ArrayMaxSize(10000)
    trades?: any[];

    @IsOptional()
    @IsArray()
    @ArrayMaxSize(10000)
    deals?: any[];

    @IsOptional()
    @Type(() => Number)
    @IsNumber()
    lastDealTicket?: number;
}

export class SyncWorkerPositionsDto {
    @Type(() => Number)
    @IsNumber()
    accountId: number;

    @IsOptional()
    @IsString()
    @MaxLength(32)
    login?: string;

    @IsOptional()
    @IsString()
    @MaxLength(120)
    server?: string;

    @IsOptional()
    @IsArray()
    @ArrayMaxSize(2000)
    positions?: any[];

    @IsOptional()
    @IsBoolean()
    skipped?: boolean;
}

export class SyncWorkerOrdersDto {
    @Type(() => Number)
    @IsNumber()
    accountId: number;

    @IsOptional()
    @IsString()
    @MaxLength(32)
    login?: string;

    @IsOptional()
    @IsArray()
    @ArrayMaxSize(2000)
    orders?: any[];
}

export class WorkerHeartbeatDto {
    @IsString()
    @MaxLength(120)
    workerId: string;

    @Type(() => Number)
    @IsNumber()
    cpuPercent: number;

    @Type(() => Number)
    @IsNumber()
    memoryPercent: number;

    @IsOptional()
    @Type(() => Number)
    @IsNumber()
    memoryUsedMb?: number;

    @IsOptional()
    @Type(() => Number)
    @IsNumber()
    memoryTotalMb?: number;

    @IsOptional()
    @Type(() => Number)
    @IsNumber()
    memoryAvailableMb?: number;

    @IsOptional()
    @Type(() => Number)
    @IsNumber()
    diskFreeGb?: number;

    @Type(() => Number)
    @IsNumber()
    activeTerminals: number;

    @IsArray()
    @ArrayMaxSize(500)
    monitoredAccounts: number[];

    @IsOptional()
    @IsString()
    @MaxLength(64)
    timestamp?: string;
}

export class SyncWorkerAccountMetricsDto {
    @Type(() => Number)
    @IsNumber()
    accountId: number;

    @IsString()
    @MaxLength(32)
    login: string;

    @IsString()
    @MaxLength(120)
    server: string;

    @IsString()
    @MaxLength(16)
    currency: string;

    @Type(() => Number)
    @IsNumber()
    balance: number;

    @Type(() => Number)
    @IsNumber()
    equity: number;

    @Type(() => Number)
    @IsNumber()
    margin: number;

    @Type(() => Number)
    @IsNumber()
    freeMargin: number;

    @IsOptional()
    @Type(() => Number)
    @IsNumber()
    marginLevel?: number;

    @Type(() => Number)
    @IsNumber()
    leverage: number;

    @IsOptional()
    @Type(() => Number)
    @IsNumber()
    profit?: number;

    @IsOptional()
    @Type(() => Number)
    @IsNumber()
    credit?: number;

    @IsOptional()
    @IsString()
    @MaxLength(160)
    company?: string;

    @IsOptional()
    @IsString()
    @MaxLength(160)
    name?: string;

    @IsOptional()
    @IsString()
    @MaxLength(40)
    tradeMode?: string;

    @IsOptional()
    @IsBoolean()
    tradeAllowed?: boolean;

    @IsOptional()
    @IsBoolean()
    tradeExpert?: boolean;

    @IsOptional()
    @Type(() => Number)
    @IsNumber()
    pingMs?: number;

    @IsOptional()
    @Type(() => Number)
    @IsNumber()
    terminalBuild?: number;

    @IsOptional()
    @IsBoolean()
    connected?: boolean;
}
