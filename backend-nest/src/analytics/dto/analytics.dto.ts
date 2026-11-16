import {
    IsArray,
    IsBoolean,
    IsNumber,
    IsOptional,
    IsString,
    MaxLength,
    ValidateNested,
} from 'class-validator';
import { Type } from 'class-transformer';

export class TrackEventDto {
    @IsString()
    @MaxLength(120)
    eventName: string;

    @IsString()
    @MaxLength(32)
    eventType: string; // 'pageview' | 'button_click' | 'conversion' | 'pixel_event' | 'custom'

    @IsString()
    @MaxLength(120)
    visitorId: string;

    @IsOptional()
    @IsString()
    @MaxLength(120)
    sessionId?: string;

    @IsOptional()
    @IsString()
    @MaxLength(512)
    pagePath?: string;

    @IsOptional()
    @IsString()
    @MaxLength(256)
    pageTitle?: string;

    @IsOptional()
    @IsString()
    @MaxLength(120)
    elementId?: string;

    @IsOptional()
    @IsString()
    @MaxLength(256)
    elementLabel?: string;

    @IsOptional()
    @IsString()
    @MaxLength(120)
    ctaTag?: string;

    @IsOptional()
    @IsString()
    @MaxLength(120)
    intent?: string;

    @IsOptional()
    @IsString()
    @MaxLength(1024)
    targetUrl?: string;

    @IsOptional()
    @IsString()
    @MaxLength(1024)
    referrer?: string;

    @IsOptional()
    @IsString()
    @MaxLength(160)
    utmSource?: string;

    @IsOptional()
    @IsString()
    @MaxLength(160)
    utmMedium?: string;

    @IsOptional()
    @IsString()
    @MaxLength(200)
    utmCampaign?: string;

    @IsOptional()
    @IsString()
    @MaxLength(200)
    utmContent?: string;

    @IsOptional()
    @IsString()
    @MaxLength(200)
    utmTerm?: string;

    @IsOptional()
    @IsString()
    @MaxLength(160)
    utmId?: string;

    @IsOptional()
    @IsString()
    @MaxLength(200)
    clickId?: string;

    @IsOptional()
    @IsString()
    @MaxLength(16)
    locale?: string;

    @IsOptional()
    @IsString()
    @MaxLength(32)
    deviceType?: string;

    @IsOptional()
    @IsNumber()
    revenue?: number;

    @IsOptional()
    @IsString()
    @MaxLength(16)
    currency?: string;

    @IsOptional()
    metadata?: Record<string, any>;
}

export class TrackBatchDto {
    @IsArray()
    @ValidateNested({ each: true })
    @Type(() => TrackEventDto)
    events: TrackEventDto[];
}

export class IdentifyVisitorDto {
    @IsString()
    @MaxLength(120)
    visitorId: string;

    @IsOptional()
    attributionData?: Record<string, any>;
}

export class RecordUserActivityDto {
    @IsString()
    @MaxLength(64)
    actionType: string;

    @IsOptional()
    @IsString()
    @MaxLength(180)
    label?: string;

    @IsOptional()
    @IsString()
    @MaxLength(255)
    pagePath?: string;

    @IsOptional()
    metadata?: Record<string, any>;
}

export class UpdatePixelConfigDto {
    @IsOptional()
    @IsString()
    @MaxLength(120)
    metaPixelId?: string;

    @IsOptional()
    @IsString()
    @MaxLength(512)
    metaCapiAccessToken?: string;

    @IsOptional()
    @IsString()
    @MaxLength(120)
    ga4MeasurementId?: string;

    @IsOptional()
    @IsString()
    @MaxLength(120)
    gtmContainerId?: string;

    @IsOptional()
    @IsString()
    @MaxLength(120)
    tiktokPixelId?: string;

    @IsOptional()
    @IsString()
    @MaxLength(120)
    utmifyPixelId?: string;

    @IsOptional()
    @IsBoolean()
    enableFirstPartyTracking?: boolean;

    @IsOptional()
    @IsBoolean()
    enableEmailTracking?: boolean;

    @IsOptional()
    @IsBoolean()
    enableCtaAutoTracking?: boolean;

    @IsOptional()
    @IsString()
    @MaxLength(4000)
    customHeadScript?: string;
}
