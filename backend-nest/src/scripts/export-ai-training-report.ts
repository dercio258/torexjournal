import * as fs from 'fs';
import * as path from 'path';
import { AppDataSource } from '../data-source';
import { AiKnowledgeBaseService } from '../ai/ai-knowledge-base.service';
import { AiPrivacySanitizerService } from '../ai/ai-privacy-sanitizer.service';
import { AiSemanticMemoryService } from '../ai/ai-semantic-memory.service';
import {
    AiTrainingReportService,
    TrainingExportFormat,
} from '../ai/ai-training-report.service';

async function main() {
    const daysArg = process.argv.find((a) => a.startsWith('--days='));
    const windowDays = daysArg ? Number(daysArg.split('=')[1]) || 30 : 30;

    console.log(`[Torex AI Export] Connecting to PostgreSQL (window=${windowDays}d)...`);
    await AppDataSource.initialize();

    try {
        const knowledgeBase = new AiKnowledgeBaseService();
        const privacySanitizer = new AiPrivacySanitizerService();
        const semanticMemory = new AiSemanticMemoryService(
            AppDataSource,
            knowledgeBase,
            privacySanitizer
        );
        await semanticMemory.ensureInitialized();

        const reportService = new AiTrainingReportService(
            AppDataSource,
            privacySanitizer,
            semanticMemory,
            knowledgeBase
        );

        const dateFolder = new Date().toISOString().slice(0, 10);
        const outputDir = path.resolve(
            process.cwd(),
            'reports',
            'ai-training',
            dateFolder
        );
        fs.mkdirSync(outputDir, { recursive: true });

        const formats: Array<{ format: TrainingExportFormat; diskName: string }> = [
            { format: 'markdown', diskName: 'REPORT.md' },
            { format: 'json', diskName: 'report.json' },
            { format: 'sft_jsonl', diskName: 'dataset_router_sft.jsonl' },
            { format: 'rag_qa_jsonl', diskName: 'dataset_rag_qa_approved.jsonl' },
            { format: 'dpo_jsonl', diskName: 'dataset_dpo_preference.jsonl' },
            { format: 'eval_jsonl', diskName: 'dataset_eval_benchmark.jsonl' },
        ];

        for (const item of formats) {
            const artifact = await reportService.exportArtifact(item.format, {
                days: windowDays,
            });
            const destPath = path.join(outputDir, item.diskName);
            fs.writeFileSync(destPath, artifact.content, 'utf8');
            console.log(
                ` - ${item.diskName.padEnd(32)} | records=${String(artifact.recordCount).padStart(4)} | pii_redactions=${artifact.piiRedactionsApplied}`
            );
        }

        console.log(`\n[Torex AI Export] All artifacts saved to: ${outputDir}`);
    } finally {
        await AppDataSource.destroy();
    }
}

main().catch((err) => {
    console.error('[Torex AI Export] Fatal error:', err);
    process.exit(1);
});
