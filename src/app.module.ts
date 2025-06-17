import { Module } from '@nestjs/common';
import { AppController } from './app.controller';
import { AppService } from './app.service';
import { ImagesModule } from './images/images.module';

@Module({
  imports: [ImagesModule],
  controllers: [AppController],
  providers: [AppService],
})
export class AppModule {}
