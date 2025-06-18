import { IsOptional, IsString, Length } from 'class-validator';

export class CreateImageDto {
  @IsString()
  @Length(1, 255)
  @IsOptional()
  description?: string;
}
