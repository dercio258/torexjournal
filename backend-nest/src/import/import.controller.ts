import { Controller, Post, UseInterceptors, UploadedFile, UseGuards, Req, Logger, BadRequestException } from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { ReportParserService } from './report-parser.service';
import { Mt5Service } from '../mt5/mt5.service';
import { ImportMethod } from '../mt5/import-log.entity';
import { PlanPermissionService, PlanTier } from '../payment/plan-permission.service';
import { PlanGuard, RequirePlan } from '../payment/plan.guard';

@Controller('import')
@UseGuards(JwtAuthGuard, PlanGuard)
@RequirePlan(PlanTier.BASIC)
export class ImportController {
    private readonly logger = new Logger(ImportController.name);

    constructor(
        private readonly reportParser: ReportParserService,
        private readonly mt5Service: Mt5Service,
        private readonly planPermissionService: PlanPermissionService
    ) { }

    @Post('report')
    @UseInterceptors(FileInterceptor('file'))
    async uploadReport(@UploadedFile() file: any, @Req() req) {
        if (!file) throw new BadRequestException('No file uploaded');

        const userId = req.user.id;
        this.logger.log(`Processing report for User ${userId}, Size: ${file.size} bytes`);

        let trades = [];

        try {
            // Detect encoding (UTF-16LE is common for MT5 reports)
            let content: string;
            const buffer = file.buffer;
            
            if (buffer[0] === 0xFF && buffer[1] === 0xFE) {
                content = buffer.toString('utf16le');
                this.logger.log('Detected UTF-16LE encoding');
            } else {
                content = buffer.toString('utf-8');
            }

            const userPlan = await this.planPermissionService.getUserPlan(userId);

            if (file.mimetype.includes('html') || file.originalname.endsWith('.html') || file.originalname.endsWith('.htm')) {
                trades = this.reportParser.parseHtml(content);
            } else if (file.mimetype.includes('csv') || file.originalname.endsWith('.csv')) {
                trades = this.reportParser.parseCsv(content);
            } else {
                throw new BadRequestException('Unsupported file format. Please upload .html or .csv');
            }

            if (trades.length === 0) {
                this.logger.warn('No trades parsed from file');
                return { success: false, message: 'No trades found in the report.' };
            }

            this.logger.log(`Parsed ${trades.length} trades. Sample: ${JSON.stringify(trades[0])}`);

            // Save trades
            const result = await this.mt5Service.saveHistory(trades, ImportMethod.FILE, userId);

            this.logger.log(`Import result: ${JSON.stringify(result)}`);

            return {
                success: true,
                message: `Importamos ${trades.length} operações! Agora, acesse o Diário para registrar suas anotações e gerenciamento de risco para gerar seu relatório de performance.`,
                count: trades.length
            };

        } catch (e) {
            this.logger.error(`Import failed: ${e.message}`);
            throw new BadRequestException(`Import failed: ${e.message}`);
        }
    }
}
