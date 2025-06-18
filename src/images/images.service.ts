import { Injectable, NotFoundException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import * as Minio from 'minio';
import * as fs from 'fs';
import { CreateImageDto } from './dto/create-image.dto';
import { Images } from './entities/images.entity';
import { v4 as uuidv4 } from 'uuid';
import * as path from 'path';

@Injectable()
export class ImagesService {
  private minioClient: Minio.Client;

  constructor(
    @InjectRepository(Images)
    private imageRepo: Repository<Images>,
  ) {
    this.minioClient = new Minio.Client({
      endPoint: process.env.MINIO_ENDPOINT!,
      port: parseInt(process.env.MINIO_PORT!) || 9000,
      useSSL: process.env.MINIO_USE_SSL === 'true',
      accessKey: process.env.MINIO_ACCESS_KEY!,
      secretKey: process.env.MINIO_SECRET_KEY!,
    });

    void this.initializeBucket();
  }

  /**
   * Initializes the MinIO bucket. If the bucket does not exist, it creates the
   * bucket and sets its policy to public read.
   *
   * @returns {Promise<void>}
   * @private
   */
  private async initializeBucket() {
    const bucketName = process.env.MINIO_BUCKET || 'images';

    try {
      const bucketExists = await this.minioClient.bucketExists(bucketName);
      if (!bucketExists) {
        await this.minioClient.makeBucket(bucketName, 'us-east-1');

        // Set bucket policy to public read
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

  /**
   * Uploads an image to MinIO and creates an image entity in the database.
   *
   * @param file The uploaded image file.
   * @param dto The image metadata.
   * @returns The created image entity.
   * @throws If the file is missing or the filename is missing.
   * @throws If the upload to MinIO fails.
   * @throws If the presigned URL or public URL cannot be generated.
   * @throws If the entity cannot be saved to the database.
   */
  public async uploadImage(file: Express.Multer.File, dto: CreateImageDto) {
    if (!file) {
      throw new Error('Cannot upload image.');
    }
    if (!file.filename) {
      throw new Error('File name is missing.');
    }

    const bucketName = process.env.MINIO_BUCKET || 'images';

    try {
      // Create image entity
      const image = new Images();
      image.id = uuidv4();
      const ext = path.extname(file.filename);
      image.filename = `${image.id}${ext}`;
      image.description = dto.description;

      // Upload file to MinIO
      const metaData = {
        'Content-Type': file.mimetype,
        'Cache-Control': 'max-age=31536000',
      };

      await this.minioClient.fPutObject(
        bucketName,
        image.filename,
        file.path,
        metaData,
      );

      // Create presigned URL or public URL
      if (process.env.MINIO_PRIVATE_ACCESS === 'true') {
        // If bucket is public access
        const protocol =
          process.env.MINIO_USE_SSL === 'true' ? 'https' : 'http';
        const port = process.env.MINIO_PORT ? `:${process.env.MINIO_PORT}` : '';
        image.url = `${protocol}://${process.env.MINIO_ENDPOINT}${port}/${bucketName}/${image.filename}`;
      } else {
        // Use presigned URL (expires in 7 days)
        image.url = await this.minioClient.presignedGetObject(
          bucketName,
          image.filename,
          24 * 60 * 60 * 7,
        );
      }

      // Soft delete
      try {
        fs.unlinkSync(file.path);
      } catch (error) {
        console.warn('Failed to delete temporary file:', error);
      }

      // Save to database
      return await this.imageRepo.save(image);
    } catch (error) {
      // Cleanup
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

  /**
   * Deletes an image from the MinIO storage and the database by its ID.
   *
   * @param {string} id - The ID of the image to be deleted.
   * @throws {NotFoundException} Throws if the image is not found in the database.
   * @returns {Promise<void>} A promise that resolves when the image is successfully deleted.
   */
  public async delete(id: string) {
    const image = await this.imageRepo.findOneBy({ id });

    if (!image) throw new NotFoundException('Image not found.');

    await this.minioClient.removeObject(
      process.env.MINIO_BUCKET!,
      image.filename,
    );
    return this.imageRepo.remove(image);
  }
}
