import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { AppController } from './app.controller';
import { DatabaseModule } from './database/database.module';
import { SitesModule } from './sites/sites.module';
import { WordpressModule } from './wordpress/wordpress.module';
import { BlogGeneratorModule } from './blog-generator/blog-generator.module';
import { SchedulerModule } from './scheduler/scheduler.module';
import { SearchConsoleModule } from './search-console/search-console.module';
import { KeywordPlannerModule } from './keyword-planner/keyword-planner.module';

@Module({
  imports: [
    ConfigModule.forRoot({ isGlobal: true }),
    DatabaseModule,
    SitesModule,
    WordpressModule,
    BlogGeneratorModule,
    SchedulerModule,
    SearchConsoleModule,
    KeywordPlannerModule,
  ],
  controllers: [AppController],
})
export class AppModule {}
