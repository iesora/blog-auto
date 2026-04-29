import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { AppController } from './app.controller';
import { AppService } from './app.service';
import { WordpressModule } from './wordpress/wordpress.module';
import { BlogGeneratorModule } from './blog-generator/blog-generator.module';

@Module({
  imports: [
    ConfigModule.forRoot({ isGlobal: true }),
    WordpressModule,
    BlogGeneratorModule,
  ],
  controllers: [AppController],
  providers: [AppService],
})
export class AppModule {}
