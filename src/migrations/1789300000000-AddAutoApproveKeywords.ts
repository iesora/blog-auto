import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * キーワード生成の自動承認を追加する。
 *
 * - sites.auto_approve_keywords: ON のサイトは生成した schedule_entries を
 *   pending ではなく approved で作る（承認作業を省く）。
 * - schedule_entries.auto_approved: その行が「人の承認」ではなく「自動承認」で
 *   approved になったことを示す。upsertProtectingApproved はこの行を保護対象から
 *   外し、再生成で上書きできるようにする。
 *
 * どちらも既定 false。既存行は auto_approved=false になるため、
 * 従来どおり「approved は上書きしない」挙動が維持される。
 */
export class AddAutoApproveKeywords1789300000000 implements MigrationInterface {
  name = 'AddAutoApproveKeywords1789300000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      'ALTER TABLE `sites` ADD `auto_approve_keywords` tinyint NOT NULL DEFAULT 0',
    );
    await queryRunner.query(
      'ALTER TABLE `schedule_entries` ADD `auto_approved` tinyint NOT NULL DEFAULT 0',
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      'ALTER TABLE `schedule_entries` DROP COLUMN `auto_approved`',
    );
    await queryRunner.query(
      'ALTER TABLE `sites` DROP COLUMN `auto_approve_keywords`',
    );
  }
}
