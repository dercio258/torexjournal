import { MigrationInterface, QueryRunner } from 'typeorm';
import { applyAiVectorSchema } from '../ai/ai-vector-schema';

export class AiVectorStoragePhase21777000000000 implements MigrationInterface {
    name = 'AiVectorStoragePhase21777000000000';

    public async up(queryRunner: QueryRunner): Promise<void> {
        await applyAiVectorSchema(queryRunner);
    }

    public async down(queryRunner: QueryRunner): Promise<void> {
        await queryRunner.query(`DROP TABLE IF EXISTS "ai_rag_chunks"`);
        await queryRunner.query(`DROP TABLE IF EXISTS "ai_intent_anchors"`);
        await queryRunner.query(
            `DROP FUNCTION IF EXISTS ai_cosine_similarity_f64(double precision[], double precision[])`
        );
    }
}
