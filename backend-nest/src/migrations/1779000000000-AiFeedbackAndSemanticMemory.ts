import { MigrationInterface, QueryRunner } from 'typeorm';
import { applyAiLearningSchema } from '../ai/ai-learning-schema';

export class AiFeedbackAndSemanticMemory1779000000000 implements MigrationInterface {
    name = 'AiFeedbackAndSemanticMemory1779000000000';

    public async up(queryRunner: QueryRunner): Promise<void> {
        await applyAiLearningSchema(queryRunner);
    }

    public async down(queryRunner: QueryRunner): Promise<void> {
        await queryRunner.query(`DROP TABLE IF EXISTS "ai_lexical_synonyms"`);
        await queryRunner.query(`DROP TABLE IF EXISTS "ai_message_feedback"`);
        await queryRunner.query(`DROP TABLE IF EXISTS "ai_semantic_memory"`);
    }
}
