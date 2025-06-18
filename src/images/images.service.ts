import { Injectable, NotFoundException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { Images } from './entities/images.entity';
import { ConfigService } from '@nestjs/config';
import { S3Client, DeleteObjectCommand } from '@aws-sdk/client-s3';
import { Upload } from '@aws-sdk/lib-storage';
import { CreateImageDto } from './dto/create-image.dto';
import { v4 as uuidv4 } from 'uuid';
import * as path from 'path';
import * as fs from 'fs';

@Injectable()
export class ImagesService {
  private readonly s3Client: S3Client;

  constructor(
    private readonly configService: ConfigService,
    @InjectRepository(Images)
    private imageRepo: Repository<Images>,
  ) {
    this.s3Client = new S3Client({
      region: this.configService.getOrThrow('AWS_S3_REGION'),
      credentials: {
        accessKeyId: this.configService.getOrThrow('AWS_ACCESS_KEY_ID'),
        secretAccessKey: this.configService.getOrThrow('AWS_SECRET_ACCESS_KEY'),
      },
    });
  }

  public async uploadImage(file: Express.Multer.File, dto: CreateImageDto) {
    if (!file) {
      throw new Error('Cannot upload image.');
    }
    if (!file.path) {
      throw new Error('File path is missing.');
    }

    try {
      const bucketName = this.configService.getOrThrow('AWS_S3_BUCKET_NAME');
      const region = this.configService.getOrThrow('AWS_S3_REGION');
      // Create image entity
      const image = new Images();
      image.id = uuidv4();
      const ext = path.extname(file.originalname);
      image.filename = `${image.id}${ext}`;
      image.description = dto.description;
      image.originalName = file.originalname;
      image.mimeType = file.mimetype;
      image.fileSize = file.size;
      image.storageProvider = 's3';
      image.url = `https://${bucketName}.s3.${region}.amazonaws.com/${image.filename}`;

      // Upload to AWS S3
      const upload = new Upload({
        client: this.s3Client,
        params: {
          Bucket: bucketName,
          Key: image.filename,
          Body: fs.createReadStream(file.path),
          ContentType: file.mimetype,
        },
      });
      await upload.done();

      // Clean up temporary file
      try {
        fs.unlinkSync(file.path);
      } catch (error) {
        console.warn('Failed to delete temporary file:', error);
      }

      // Save to database
      return await this.imageRepo.save(image);
    } catch (error) {
      // Clean up temporary file on error
      try {
        fs.unlinkSync(file.path);
      } catch (unlinkError) {
        console.warn(
          'Failed to delete temporary file after error:',
          unlinkError,
        );
      }

      throw new Error(`Failed to upload image: ${error.message}`);
    }
  }

  public async findOne(id: string): Promise<Images> {
    const image = await this.imageRepo.findOne({ where: { id } });
    if (!image) {
      throw new NotFoundException(`Image with ID ${id} not found`);
    }
    return image;
  }

  public async delete(id: string): Promise<void> {
    const image = await this.findOne(id);
    const bucketName = this.configService.getOrThrow('AWS_S3_BUCKET_NAME');

    try {
      // Delete from S3
      const deleteCommand = new DeleteObjectCommand({
        Bucket: bucketName,
        Key: image.filename,
      });
      await this.s3Client.send(deleteCommand);

      // Delete from database
      await this.imageRepo.delete(id);
    } catch (error) {
      throw new Error(`Failed to delete image: ${error.message}`);
    }
  }
}
