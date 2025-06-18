import { BadRequestException, Module } from '@nestjs/common';
import { ImagesService } from './images.service';
import { ImagesController } from './images.controller';
import { TypeOrmModule } from '@nestjs/typeorm';
import { Images } from './entities/images.entity';
import { MulterModule } from '@nestjs/platform-express';
import { diskStorage } from 'multer';
import * as path from 'path';

@Module({
  imports: [
    TypeOrmModule.forFeature([Images]),
    MulterModule.register({
      storage: diskStorage({
        destination: './uploads',
        filename: (req, file, cb) => {
          cb(null, file.originalname);
        },
      }),
      limits: {
        // Limit 2MB
        fileSize: 2 * 1024 * 1024,
      },
      fileFilter: (req, file, cb) => {
        // Allow only image files type jpg, jpeg, png
        const ext = path.extname(file.originalname).toLowerCase();
        if (ext === '.jpeg' || ext === '.png' || ext === '.jpg') {
          cb(null, true);
        } else {
          cb(
            new BadRequestException(
              'Allow only image files type jpg, jpeg, png!',
            ),
            false,
          );
        }
      },
    }),
  ],
  controllers: [ImagesController],
  providers: [ImagesService],
})
export class ImagesModule {}
