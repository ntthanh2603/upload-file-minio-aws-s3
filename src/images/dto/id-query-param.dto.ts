import { IsUUID } from 'class-validator';

export class IdQueryParamDto {
  @IsUUID('4')
  id: string;
}
