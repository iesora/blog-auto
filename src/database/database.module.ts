import { Module } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { TypeOrmModule } from '@nestjs/typeorm';
import {
  GscQueryRow,
  GscSnapshot,
  KeywordPlan,
  RunHistory,
  ScheduleEntry,
  Site,
} from '../entities';
import { InitV2Schema1715817600000 } from '../migrations/1715817600000-InitV2Schema';
import { AddMarketingStrategyToSnapshots1781600000000 } from '../migrations/1781600000000-AddMarketingStrategyToSnapshots';
import { ReplacePersonaWithPromptTemplates1786900000000 } from '../migrations/1786900000000-ReplacePersonaWithPromptTemplates';

const ENTITIES = [
  Site,
  ScheduleEntry,
  RunHistory,
  KeywordPlan,
  GscSnapshot,
  GscQueryRow,
];

const MIGRATIONS = [
  InitV2Schema1715817600000,
  AddMarketingStrategyToSnapshots1781600000000,
  ReplacePersonaWithPromptTemplates1786900000000,
];

@Module({
  imports: [
    TypeOrmModule.forRootAsync({
      inject: [ConfigService],
      useFactory: (config: ConfigService) => {
        const isProd = process.env.NODE_ENV === 'production';
        const socketPath = config.get<string>('DB_SOCKET_PATH');
        return {
          type: 'mysql',
          host: isProd ? config.get<string>('DB_HOST') : 'localhost',
          port: +(config.get<string>('DB_PORT') ?? 3306),
          username: isProd ? config.get<string>('DB_USERNAME') : 'develop',
          password: isProd ? config.get<string>('DB_PASSWORD') : 'password',
          database: isProd ? config.get<string>('DB_DATABASE') : 'develop',
          entities: ENTITIES,
          migrations: MIGRATIONS,
          migrationsRun: isProd,
          synchronize: false,
          timezone: '+09:00',
          charset: 'utf8mb4_unicode_ci',
          extra: socketPath ? { socketPath } : undefined,
        };
      },
    }),
  ],
})
export class DatabaseModule {}
