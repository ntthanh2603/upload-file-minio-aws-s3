import { Injectable, NotFoundException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { Images } from './entities/images.entity';
import { ConfigService } from '@nestjs/config';
import { S3Client, DeleteObjectCommand } from '@aws-sdk/client-s3';
import { Upload } from '@aws-sdk/lib-storage';
import * as Minio from 'minio';
import { CreateImageDto } from './dto/create-image.dto';
import { v4 as uuidv4 } from 'uuid';
import * as path from 'path';
import * as fs from 'fs';

@Injectable()
export class ImagesService {
  private s3Client: S3Client | null = null;
  private minioClient: Minio.Client | null = null;
  private storageProvider: string;

  constructor(
    private readonly configService: ConfigService,
    @InjectRepository(Images)
    private imageRepo: Repository<Images>,
  ) {
    this.storageProvider = this.configService
      .getOrThrow('STORAGE_PROVIDER')
      .toLowerCase();
    if (this.storageProvider === 's3') {
      this.s3Client = new S3Client({
        region: this.configService.getOrThrow('AWS_S3_REGION'),
        credentials: {
          accessKeyId: this.configService.getOrThrow('AWS_ACCESS_KEY_ID'),
          secretAccessKey: this.configService.getOrThrow(
            'AWS_SECRET_ACCESS_KEY',
          ),
        },
      });
    } else if (this.storageProvider === 'minio') {
      this.minioClient = new Minio.Client({
        endPoint: this.configService.getOrThrow('MINIO_ENDPOINT'),
        port: parseInt(this.configService.getOrThrow('MINIO_PORT')) || 9000,
        useSSL: this.configService.getOrThrow('MINIO_USE_SSL') === 'true',
        accessKey: this.configService.getOrThrow('MINIO_ACCESS_KEY'),
        secretKey: this.configService.getOrThrow('MINIO_SECRET_KEY'),
      });
      void this.initializeBucket();
    } else {
      throw new Error('Invalid STORAGE_PROVIDER. Use "s3" or "minio".');
    }
  }

  private async initializeBucket() {
    const bucketName =
      this.configService.getOrThrow('MINIO_BUCKET') || 'images';
    if (this.minioClient) {
      try {
        const bucketExists = await this.minioClient.bucketExists(bucketName);
        if (!bucketExists) {
          await this.minioClient.makeBucket(bucketName, 'us-east-1');
          const policy = {
            Version: '2012-10-17',
            Statement: [
              {
                Effect: 'Allow',
                Principal: '*',
                Action: ['s3:GetObject'],
                Resource: [`arn:aws:s3:::${bucketName}/*`],
              },
            ],
          };
          await this.minioClient.setBucketPolicy(
            bucketName,
            JSON.stringify(policy),
          );
        }
      } catch (error) {
        console.error('Failed to initialize bucket:', error);
      }
    }
  }

  public async uploadImage(file: Express.Multer.File, dto: CreateImageDto) {
    if (!file) {
      throw new Error('Cannot upload image.');
    }
    if (!file.path) {
      throw new Error('File path is missing.');
    }

    try {
      const image = new Images();
      image.id = uuidv4();
      const ext = path.extname(file.originalname);
      image.filename = `${image.id}${ext}`;
      image.description = dto.description;
      image.originalName = file.originalname;
      image.mimeType = file.mimetype;
      image.fileSize = file.size;
      image.storageProvider = this.storageProvider;

      if (this.storageProvider === 's3') {
        const bucketName = this.configService.getOrThrow('AWS_S3_BUCKET_NAME');
        const region = this.configService.getOrThrow('AWS_S3_REGION');
        const upload = new Upload({
          client: this.s3Client!,
          params: {
            Bucket: bucketName,
            Key: image.filename,
            Body: fs.createReadStream(file.path),
            ContentType: file.mimetype,
          },
        });
        await upload.done();
        image.url = `https://${bucketName}.s3.${region}.amazonaws.com/${image.filename}`;
      } else if (this.storageProvider === 'minio') {
        const bucketName =
          this.configService.getOrThrow('MINIO_BUCKET') || 'images';
        const metaData = {
          'Content-Type': file.mimetype,
          'Cache-Control': 'max-age=31536000',
        };
        await this.minioClient!.fPutObject(
          bucketName,
          image.filename,
          file.path,
          metaData,
        );
        const protocol =
          this.configService.getOrThrow('MINIO_USE_SSL') === 'true'
            ? 'https'
            : 'http';
        const port = this.configService.getOrThrow('MINIO_PORT')
          ? `:${this.configService.getOrThrow('MINIO_PORT')}`
          : '';
        image.url = `${protocol}://${this.configService.getOrThrow('MINIO_ENDPOINT')}${port}/${bucketName}/${image.filename}`;
      }

      try {
        fs.unlinkSync(file.path);
      } catch (error) {
        console.warn('Failed to delete temporary file:', error);
      }

      return await this.imageRepo.save(image);
    } catch (error) {
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

    try {
      if (image.storageProvider === 's3') {
        const bucketName = this.configService.getOrThrow('AWS_S3_BUCKET_NAME');
        const deleteCommand = new DeleteObjectCommand({
          Bucket: bucketName,
          Key: image.filename,
        });
        await this.s3Client!.send(deleteCommand);
      } else if (image.storageProvider === 'minio') {
        const bucketName =
          this.configService.getOrThrow('MINIO_BUCKET') || 'images';
        await this.minioClient!.removeObject(bucketName, image.filename);
      }
      await this.imageRepo.delete(id);
    } catch (error) {
      throw new Error(`Failed to delete image: ${error.message}`);
    }
  }
}
