import { Injectable, Logger } from '@nestjs/common';
import { ImportMethod } from '../../mt5/import-log.entity';
import { ITradeAdapter } from './trade-adapter.interface';
import { Mt5Adapter } from './adapters/mt5.adapter';
import { CsvAdapter } from './adapters/csv.adapter';
import { DerivAdapter } from './adapters/deriv.adapter';
import { NormalizedTradeDto } from './normalized-trade.dto';

@Injectable()
export class NormalizationService {
    private readonly logger = new Logger(NormalizationService.name);
    private readonly adapters = new Map<ImportMethod, ITradeAdapter>();

    constructor() {
        this.adapters.set(ImportMethod.EA, new Mt5Adapter());
        this.adapters.set(ImportMethod.FILE, new CsvAdapter());
        // WebTrader uses standard MT5 Payload often, or we can map it separately
        this.adapters.set(ImportMethod.MANUAL, new Mt5Adapter()); // For now manual is same as MT5
        this.adapters.set(ImportMethod.DERIV, new DerivAdapter());
    }

    normalizeBatch(rawDataArray: any[], method: ImportMethod): NormalizedTradeDto[] {
        const adapter = this.adapters.get(method);

        if (!adapter) {
            this.logger.warn(`No adapter found for method ${method}. Attempting generic parsing.`);
            // Fallback generic parse using CSV adapter logic which is very loose
            return this.genericFallbackParsing(rawDataArray);
        }

        const dataToProcess = adapter.preprocessBatch ? adapter.preprocessBatch(rawDataArray) : rawDataArray;

        const normalized: NormalizedTradeDto[] = [];
        for (const raw of dataToProcess) {
            try {
                const normTrade = adapter.normalize(raw);
                if (normTrade) {
                    normalized.push(normTrade);
                }
            } catch (err) {
                this.logger.warn(`Failed to normalize trade: ${err.message}. Raw: ${JSON.stringify(raw).substring(0, 100)}`);
            }
        }

        return normalized;
    }

    // Fallback if no specific method was chosen
    private genericFallbackParsing(rawDataArray: any[]): NormalizedTradeDto[] {
        const adapter = new CsvAdapter();
        return rawDataArray
            .map(r => adapter.normalize(r))
            .filter(r => r !== null) as NormalizedTradeDto[];
    }
}
