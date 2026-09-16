import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * サイトごとの投稿ステータス `post_status` を追加する。
 *
 * 生成した記事を WordPress に下書きで入れるか、そのまま公開するかをサイト単位で
 * 切り替えるためのもの。既存サイトが意図せず公開に変わらないよう、既定値は
 * 'draft' にして NOT NULL で追加する。
 */
export class AddPostStatusToSites1789200000000 implements MigrationInterface {
  name = 'AddPostStatusToSites1789200000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      "ALTER TABLE `sites` ADD `post_status` enum('draft','publish') NOT NULL DEFAULT 'draft'",
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query('ALTER TABLE `sites` DROP COLUMN `post_status`');
  }
}
