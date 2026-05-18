import { MigrationInterface, QueryRunner } from 'typeorm';

export class InitV2Schema1715817600000 implements MigrationInterface {
  name = 'InitV2Schema1715817600000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    // sites
    await queryRunner.query(`
      CREATE TABLE \`sites\` (
        \`id\` int NOT NULL AUTO_INCREMENT,
        \`slug\` varchar(64) NOT NULL,
        \`name\` varchar(128) NOT NULL,
        \`wp_url\` varchar(255) NOT NULL,
        \`wp_username\` varchar(128) NOT NULL,
        \`wp_app_pw_encrypted\` text NOT NULL,
        \`gsc_site_url\` varchar(255) NOT NULL,
        \`default_article_type\` enum('seo','repair_report','qa','ranking') NOT NULL DEFAULT 'seo',
        \`default_categories\` json NULL,
        \`default_tags\` json NULL,
        \`persona\` text NULL,
        \`active\` tinyint NOT NULL DEFAULT 1,
        \`created_at\` datetime(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
        \`updated_at\` datetime(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6) ON UPDATE CURRENT_TIMESTAMP(6),
        UNIQUE INDEX \`IDX_sites_slug\` (\`slug\`),
        PRIMARY KEY (\`id\`)
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4
    `);

    // gsc_snapshots
    await queryRunner.query(`
      CREATE TABLE \`gsc_snapshots\` (
        \`id\` int NOT NULL AUTO_INCREMENT,
        \`site_id\` int NOT NULL,
        \`start_date\` date NOT NULL,
        \`end_date\` date NOT NULL,
        \`row_count\` int NOT NULL,
        \`taken_at\` datetime NOT NULL DEFAULT CURRENT_TIMESTAMP,
        \`data_state\` varchar(16) NOT NULL DEFAULT 'final',
        PRIMARY KEY (\`id\`),
        CONSTRAINT \`FK_gsc_snapshots_site\` FOREIGN KEY (\`site_id\`)
          REFERENCES \`sites\` (\`id\`) ON DELETE CASCADE
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4
    `);

    // gsc_query_rows
    await queryRunner.query(`
      CREATE TABLE \`gsc_query_rows\` (
        \`id\` int NOT NULL AUTO_INCREMENT,
        \`snapshot_id\` int NOT NULL,
        \`query\` varchar(255) NOT NULL,
        \`page\` varchar(512) NULL,
        \`clicks\` int NOT NULL,
        \`impressions\` int NOT NULL,
        \`ctr\` float NOT NULL,
        \`position\` float NOT NULL,
        PRIMARY KEY (\`id\`),
        INDEX \`idx_gsc_snapshot_impressions\` (\`snapshot_id\`, \`impressions\`),
        CONSTRAINT \`FK_gsc_query_rows_snapshot\` FOREIGN KEY (\`snapshot_id\`)
          REFERENCES \`gsc_snapshots\` (\`id\`) ON DELETE CASCADE
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4
    `);

    // keyword_plans
    await queryRunner.query(`
      CREATE TABLE \`keyword_plans\` (
        \`id\` int NOT NULL AUTO_INCREMENT,
        \`site_id\` int NOT NULL,
        \`cycle_start\` date NOT NULL,
        \`cycle_end\` date NOT NULL,
        \`status\` enum('draft','approved','rejected') NOT NULL DEFAULT 'draft',
        \`snapshot_id\` int NULL,
        \`generated_by\` varchar(64) NOT NULL DEFAULT 'claude-sonnet-4-6',
        \`approved_by\` varchar(128) NULL,
        \`approved_at\` datetime NULL,
        \`raw_response\` json NULL,
        \`created_at\` datetime(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
        PRIMARY KEY (\`id\`),
        INDEX \`idx_plan_site_cycle\` (\`site_id\`, \`cycle_start\`),
        CONSTRAINT \`FK_keyword_plans_site\` FOREIGN KEY (\`site_id\`)
          REFERENCES \`sites\` (\`id\`) ON DELETE CASCADE,
        CONSTRAINT \`FK_keyword_plans_snapshot\` FOREIGN KEY (\`snapshot_id\`)
          REFERENCES \`gsc_snapshots\` (\`id\`) ON DELETE SET NULL
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4
    `);

    // schedule_entries
    await queryRunner.query(`
      CREATE TABLE \`schedule_entries\` (
        \`id\` int NOT NULL AUTO_INCREMENT,
        \`site_id\` int NOT NULL,
        \`scheduled_date\` date NOT NULL,
        \`status\` enum('pending','approved','skipped') NOT NULL DEFAULT 'pending',
        \`keyword1\` varchar(100) NOT NULL,
        \`keyword2\` varchar(100) NOT NULL,
        \`keyword3\` varchar(100) NOT NULL,
        \`topic\` text NULL,
        \`article_type\` enum('seo','repair_report','qa','ranking') NULL,
        \`category_names\` json NULL,
        \`tag_names\` json NULL,
        \`inline_image_count\` tinyint NULL,
        \`source\` enum('manual','auto') NOT NULL DEFAULT 'manual',
        \`plan_id\` int NULL,
        \`created_at\` datetime(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
        \`updated_at\` datetime(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6) ON UPDATE CURRENT_TIMESTAMP(6),
        PRIMARY KEY (\`id\`),
        UNIQUE INDEX \`uq_schedule_site_date\` (\`site_id\`, \`scheduled_date\`),
        INDEX \`idx_schedule_date_status\` (\`scheduled_date\`, \`status\`),
        CONSTRAINT \`FK_schedule_entries_site\` FOREIGN KEY (\`site_id\`)
          REFERENCES \`sites\` (\`id\`) ON DELETE CASCADE,
        CONSTRAINT \`FK_schedule_entries_plan\` FOREIGN KEY (\`plan_id\`)
          REFERENCES \`keyword_plans\` (\`id\`) ON DELETE SET NULL
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4
    `);

    // run_history
    await queryRunner.query(`
      CREATE TABLE \`run_history\` (
        \`id\` int NOT NULL AUTO_INCREMENT,
        \`schedule_entry_id\` int NOT NULL,
        \`status\` enum('success','failed') NOT NULL,
        \`ran_at\` datetime NOT NULL,
        \`wp_post_id\` int NULL,
        \`wp_post_link\` varchar(512) NULL,
        \`wp_post_title\` varchar(512) NULL,
        \`error\` text NULL,
        \`duration_ms\` int NULL,
        PRIMARY KEY (\`id\`),
        INDEX \`idx_run_entry_ranat\` (\`schedule_entry_id\`, \`ran_at\`),
        CONSTRAINT \`FK_run_history_schedule_entry\` FOREIGN KEY (\`schedule_entry_id\`)
          REFERENCES \`schedule_entries\` (\`id\`) ON DELETE CASCADE
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP TABLE \`run_history\``);
    await queryRunner.query(`DROP TABLE \`schedule_entries\``);
    await queryRunner.query(`DROP TABLE \`keyword_plans\``);
    await queryRunner.query(`DROP TABLE \`gsc_query_rows\``);
    await queryRunner.query(`DROP TABLE \`gsc_snapshots\``);
    await queryRunner.query(`DROP TABLE \`sites\``);
  }
}
