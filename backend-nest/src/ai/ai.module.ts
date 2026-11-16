import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { HttpModule } from '@nestjs/axios';
import { AiController } from './ai.controller';
import { AiService } from './ai.service';
import { AiInsightEntity } from './ai-insight.entity';
import {
    AiChatJobEntity,
    AiChatMessageEntity,
    AiChatSessionEntity,
} from './ai-chat.entity';
import { AiUserCreditEntity } from './ai-credits.entity';
import { AiCreditsService } from './ai-credits.service';
import { AiKnowledgeBaseService } from './ai-knowledge-base.service';
import { AiTradeAnalyzerService } from './ai-trade-analyzer.service';
import { AiLlmProviderService } from './ai-llm-provider.service';
import { AiPromptSystemService } from './ai-prompt-system.service';
import { AiRouterService } from './ai-router.service';
import { TorexAiChatService } from './torex-ai-chat.service';
import { AiEmbeddingService } from './ai-embedding.service';
import { AiVectorStoreService } from './ai-vector-store.service';
import { AiSemanticIntentRouterService } from './ai-semantic-intent-router.service';
import { AiDeterministicSqlToolsService } from './ai-deterministic-sql-tools.service';
import { AiRagService } from './ai-rag.service';
import { AiPrivacySanitizerService } from './ai-privacy-sanitizer.service';
import { AiUserProfileService } from './ai-user-profile.service';
import { AiFeedbackSignalsService } from './ai-feedback-signals.service';
import { AiReplyCacheService } from './ai-reply-cache.service';
import { AiSemanticMemoryService } from './ai-semantic-memory.service';
import { AiAutoLearningService } from './ai-auto-learning.service';
import { AiTrainingReportService } from './ai-training-report.service';
import { AccountEntity } from '../account/account.entity';
import { TradeEntity } from '../mt5/trade.entity';
import { PositionEntity } from '../mt5/position.entity';
import { BacktestSession } from '../dashboard/backtest-session.entity';
import {
    DailyNoteEntity,
    GeneralNoteEntity,
    TradeNoteEntity,
} from '../dashboard/journal-notes.entity';
import { UserEntity } from '../users/user.entity';
import { NotificationsModule } from '../notifications/notifications.module';
import { PaymentModule } from '../payment/payment.module';
import { DashboardModule } from '../dashboard/dashboard.module';
import { AlertsModule } from '../alerts/alerts.module';

@Module({
    imports: [
        TypeOrmModule.forFeature([
            AiInsightEntity,
            AiChatSessionEntity,
            AiChatMessageEntity,
            AiChatJobEntity,
            AiUserCreditEntity,
            AccountEntity,
            TradeEntity,
            PositionEntity,
            DailyNoteEntity,
            TradeNoteEntity,
            GeneralNoteEntity,
            BacktestSession,
            UserEntity,
        ]),
        HttpModule,
        NotificationsModule,
        PaymentModule,
        DashboardModule,
        AlertsModule,
    ],
    controllers: [AiController],
    providers: [
        AiService,
        AiCreditsService,
        AiKnowledgeBaseService,
        AiTradeAnalyzerService,
        AiLlmProviderService,
        AiEmbeddingService,
        AiVectorStoreService,
        AiSemanticIntentRouterService,
        AiDeterministicSqlToolsService,
        AiRagService,
        AiPromptSystemService,
        AiPrivacySanitizerService,
        AiUserProfileService,
        AiFeedbackSignalsService,
        AiReplyCacheService,
        AiSemanticMemoryService,
        AiRouterService,
        AiAutoLearningService,
        AiTrainingReportService,
        TorexAiChatService,
    ],
    exports: [
        AiService,
        AiCreditsService,
        AiKnowledgeBaseService,
        AiEmbeddingService,
        AiVectorStoreService,
        AiSemanticIntentRouterService,
        AiDeterministicSqlToolsService,
        AiRagService,
        AiPromptSystemService,
        AiPrivacySanitizerService,
        AiUserProfileService,
        AiFeedbackSignalsService,
        AiSemanticMemoryService,
        AiAutoLearningService,
        AiTrainingReportService,
        AiRouterService,
        TorexAiChatService,
    ],
})
export class AiModule {}
