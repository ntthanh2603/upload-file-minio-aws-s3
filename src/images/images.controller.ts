import {
  Controller,
  Post,
  UploadedFile,
  UseInterceptors,
  Body,
  Get,
  Param,
  Delete,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { ImagesService } from './images.service';
import { CreateImageDto } from './dto/create-image.dto';
import { IdQueryParamDto } from './dto/id-query-param.dto';

@Controller('images')
export class ImagesController {
  constructor(private readonly imagesService: ImagesService) {}

  @Post()
  @UseInterceptors(FileInterceptor('file'))
  upload(
    @UploadedFile() file: Express.Multer.File,
    @Body() dto: CreateImageDto,
  ) {
    return this.imagesService.uploadImage(file, dto);
  }

  @Get(':id')
  findOne(@Param() { id }: IdQueryParamDto) {
    return this.imagesService.findOne(id);
  }

  @Delete(':id')
  remove(@Param() { id }: IdQueryParamDto) {
    return this.imagesService.delete(id);
  }
}
