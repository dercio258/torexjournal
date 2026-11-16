import { Global, Module } from '@nestjs/common';
import { HealthController } from './health.controller';
import { PinoLoggerService } from './pino-logger.service';
import { TelemetryService } from './telemetry.service';

@Global()
@Module({
    controllers: [HealthController],
    providers: [PinoLoggerService, TelemetryService],
    exports: [PinoLoggerService, TelemetryService],
})
export class ObservabilityModule {}
