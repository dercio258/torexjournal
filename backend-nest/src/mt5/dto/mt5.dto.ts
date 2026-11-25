import { Transform } from 'class-transformer';
import {
    ArrayMaxSize,
    IsArray,
    IsBoolean,
    IsIn,
    IsInt,
    IsNumber,
    IsOptional,
    IsString,
    IsUUID,
    Matches,
    Max,
    MaxLength,
    Min,
    MinLength,
} from 'class-validator';

const trimStr = ({ value }: { value: unknown }) =>
    typeof value === 'string' ? value.trim() : value;

export class SendMt5CommandDto {
    @IsInt()
    @Min(0)
    @Max(9999)
    type: number;

    @IsOptional()
    @IsString()
    @MaxLength(4096)
    payload?: string;
}

export class SubmitBehaviorFeedbackDto {
    @IsIn(['CONFIRM', 'FALSE_POSITIVE'])
    verdict: 'CONFIRM' | 'FALSE_POSITIVE';

    @IsOptional()
    @IsArray()
    @ArrayMaxSize(20)
    @IsString({ each: true })
    correctedFlags?: string[];

    @IsOptional()
    @Transform(trimStr)
    @IsString()
    @MaxLength(1000)
    note?: string;
}

export class ConnectCloudMt5Dto {
    @Transform(trimStr)
    @IsString()
    @Matches(/^\d{4,16}$/, { message: 'Informe um login MT5 numérico válido (4-16 dígitos).' })
    login: string;

    @IsString()
    @MinLength(1, { message: 'Informe a senha da conta MT5.' })
    @MaxLength(128)
    pass: string;

    @Transform(trimStr)
    @IsString()
    @MinLength(2, { message: 'Informe o servidor da corretora.' })
    @MaxLength(120)
    server: string;

    @IsOptional()
    @Transform(trimStr)
    @IsString()
    @MaxLength(64)
    accountId?: string;
}

export class SyncCloudMt5Dto {
    @IsOptional()
    @Transform(trimStr)
    @IsString()
    @MaxLength(32)
    login?: string;

    @IsOptional()
    @Transform(trimStr)
    @IsString()
    @MaxLength(64)
    accountId?: string;

    @IsOptional()
    @IsBoolean()
    forceFull?: boolean;
}

export class KeepAliveCloudMt5Dto {
    @Transform(trimStr)
    @IsUUID('4', { message: 'Informe um identificador de conta válido.' })
    accountId: string;
}

export class DisconnectCloudMt5Dto {
    @IsOptional()
    @Transform(trimStr)
    @IsString()
    @MaxLength(32)
    login?: string;

    @IsOptional()
    @Transform(trimStr)
    @IsString()
    @MaxLength(64)
    accountId?: string;
}

export class SaveMarketFeedDemoDto {
    @Transform(trimStr)
    @IsString()
    @Matches(/^\d{4,16}$/, { message: 'Informe um login MT5 Demo numérico válido.' })
    login: string;

    @IsOptional()
    @IsString()
    @MaxLength(128)
    pass?: string;

    @Transform(trimStr)
    @IsString()
    @MinLength(2)
    @MaxLength(120)
    server: string;
}

export class PrefetchDemoSessionDto {
    @IsOptional()
    @Transform(trimStr)
    @IsString()
    @MaxLength(64)
    sessionId?: string;

    @IsArray()
    @ArrayMaxSize(20)
    @IsString({ each: true })
    symbols: string[];

    @Transform(trimStr)
    @IsString()
    @MaxLength(16)
    timeframe: string;

    @IsOptional()
    @Transform(trimStr)
    @IsString()
    @MaxLength(40)
    fromDate?: string;

    @IsOptional()
    @Transform(trimStr)
    @IsString()
    @MaxLength(40)
    toDate?: string;

    @IsOptional()
    @Transform(trimStr)
    @IsString()
    @MaxLength(32)
    demoLogin?: string;

    @IsOptional()
    @IsString()
    @MaxLength(128)
    demoPass?: string;

    @IsOptional()
    @Transform(trimStr)
    @IsString()
    @MaxLength(120)
    demoServer?: string;
}

export class CreateManualTradeDto {
    @Transform(trimStr)
    @IsString()
    @MinLength(1)
    @MaxLength(32)
    symbol: string;

    @Transform(trimStr)
    @IsString()
    @MaxLength(16)
    type: string;

    @IsOptional()
    @IsNumber()
    volume?: number;

    @IsOptional()
    @IsNumber()
    lots?: number;

    @IsOptional()
    @IsNumber()
    openPrice?: number;

    @IsOptional()
    @IsNumber()
    closePrice?: number;

    @IsOptional()
    @IsNumber()
    entryPrice?: number;

    @IsOptional()
    @IsNumber()
    exitPrice?: number;

    @IsOptional()
    @IsNumber()
    profit?: number;

    @IsOptional()
    @IsNumber()
    pnl?: number;

    @IsOptional()
    @IsNumber()
    commission?: number;

    @IsOptional()
    @IsNumber()
    swap?: number;

    @IsOptional()
    @IsNumber()
    stopLoss?: number;

    @IsOptional()
    @IsNumber()
    takeProfit?: number;

    @IsOptional()
    @IsNumber()
    sl?: number;

    @IsOptional()
    @IsNumber()
    tp?: number;

    @IsOptional()
    @IsString()
    @MaxLength(64)
    openTime?: string;

    @IsOptional()
    @IsString()
    @MaxLength(64)
    closeTime?: string;

    @IsOptional()
    @IsString()
    @MaxLength(64)
    accountId?: string;

    @IsOptional()
    @IsString()
    @MaxLength(64)
    ticket?: string;

    @IsOptional()
    @IsString()
    @MaxLength(120)
    strategy?: string;

    @IsOptional()
    @IsString()
    @MaxLength(120)
    setup?: string;

    @IsOptional()
    @IsString()
    @MaxLength(64)
    emotion?: string;

    @IsOptional()
    @IsString()
    @MaxLength(64)
    session?: string;

    @IsOptional()
    @IsString()
    @MaxLength(10000)
    notes?: string;

    @IsOptional()
    @IsString()
    @MaxLength(10000)
    comment?: string;

    @IsOptional()
    @IsString()
    @MaxLength(32)
    status?: string;
}
