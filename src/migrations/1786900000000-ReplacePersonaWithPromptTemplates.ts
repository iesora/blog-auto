import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * サイトの `persona`（自由記述のトーン指定）を廃止し、記事タイプごとの
 * 生成プロンプト `prompt_templates` に置き換える。
 *
 * prompt_templates は {"seo": "...", "qa": "..."} 形式の JSON。
 * キーが無い記事タイプは prompt-templates.ts の既定値が使われるため、
 * 既存サイトは NULL のままで従来どおりの生成結果になる。
 */
export class ReplacePersonaWithPromptTemplates1786900000000 implements MigrationInterface {
  name = 'ReplacePersonaWithPromptTemplates1786900000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      'ALTER TABLE `sites` ADD `prompt_templates` json NULL',
    );
    await queryRunner.query('ALTER TABLE `sites` DROP COLUMN `persona`');
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query('ALTER TABLE `sites` ADD `persona` text NULL');
    await queryRunner.query(
      'ALTER TABLE `sites` DROP COLUMN `prompt_templates`',
    );
  }
}
