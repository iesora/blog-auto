import { MigrationInterface, QueryRunner } from 'typeorm';

export class AddMarketingStrategyToSnapshots1781600000000 implements MigrationInterface {
  name = 'AddMarketingStrategyToSnapshots1781600000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      ALTER TABLE \`gsc_snapshots\`
        ADD COLUMN \`marketing_strategy\` text NULL,
        ADD COLUMN \`marketing_generated_by\` varchar(64) NULL,
        ADD COLUMN \`marketing_generated_at\` datetime NULL
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      ALTER TABLE \`gsc_snapshots\`
        DROP COLUMN \`marketing_strategy\`,
        DROP COLUMN \`marketing_generated_by\`,
        DROP COLUMN \`marketing_generated_at\`
    `);
  }
}
