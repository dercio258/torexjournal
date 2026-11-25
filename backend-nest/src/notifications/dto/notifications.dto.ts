import { Transform } from 'class-transformer';
import {
    IsBoolean,
    IsIn,
    IsOptional,
    IsString,
    MaxLength,
} from 'class-validator';

const trimStr = ({ value }: { value: unknown }) =>
    typeof value === 'string' ? value.trim() : value;

export class UpdateNotificationSettingsDto {
    @IsOptional()
    @IsBoolean()
    notificationsEnabled?: boolean;

    @IsOptional()
    @IsBoolean()
    telegramEnabled?: boolean;

    @IsOptional()
    @Transform(trimStr)
    @IsString()
    @MaxLength(64)
    telegramChatId?: string | null;

    @IsOptional()
    @IsBoolean()
    emailNotifications?: boolean;

    @IsOptional()
    @IsBoolean()
    pushEnabled?: boolean;

    @IsOptional()
    @IsBoolean()
    tradeAlerts?: boolean;

    @IsOptional()
    @IsBoolean()
    dailyReport?: boolean;

    @IsOptional()
    @IsBoolean()
    weeklyReport?: boolean;

    @IsOptional()
    @Transform(trimStr)
    @IsString()
    @MaxLength(64)
    accountId?: string;
}

export class TestNotificationDto {
    @IsOptional()
    @Transform(trimStr)
    @IsString()
    @MaxLength(160)
    title?: string;

    @IsOptional()
    @Transform(trimStr)
    @IsString()
    @MaxLength(1000)
    message?: string;

    @IsOptional()
    @IsIn(['INFO', 'SUCCESS', 'WARNING', 'ERROR', 'ALERT'])
    type?: string;
}
