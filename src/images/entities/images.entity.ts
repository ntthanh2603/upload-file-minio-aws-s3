import { Column, Entity, PrimaryGeneratedColumn } from 'typeorm';

@Entity('images')
export class Images {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column()
  filename: string;

  @Column()
  url: string;

  @Column({ nullable: true })
  description?: string;
}
