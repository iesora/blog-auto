import { DataSource } from 'typeorm';
import {
  Site,
  ScheduleEntry,
  RunHistory,
  KeywordPlan,
  GscSnapshot,
  GscQueryRow,
} from '../entities';

const isProd = process.env.NODE_ENV === 'production';

export const AppDataSource = new DataSource({
  type: 'mysql',
  host: isProd ? process.env.DB_HOST : 'localhost',
  port: 3306,
  username: isProd ? process.env.DB_USERNAME : 'develop',
  password: isProd ? process.env.DB_PASSWORD : 'password',
  database: isProd ? process.env.DB_DATABASE : 'develop',
  entities: [
    Site,
    ScheduleEntry,
    RunHistory,
    KeywordPlan,
    GscSnapshot,
    GscQueryRow,
  ],
  migrations: isProd ? ['dist/migrations/*.js'] : ['src/migrations/*.ts'],
  synchronize: false,
  logging: !isProd,
  timezone: '+09:00',
  charset: 'utf8mb4_unicode_ci',
  extra: {
    socketPath: process.env.DB_SOCKET_PATH || undefined,
  },
});
