import {
  Entity,
  PrimaryGeneratedColumn,
  Column,
  CreateDateColumn,
} from "typeorm";

@Entity("properties")
export class Property {
  @PrimaryGeneratedColumn()
  id_internal!: number;

  @Column({ unique: true })
  id!: string;

  @Column()
  url!: string;

  @Column({ nullable: true })
  operacion!: string;

  @Column({ nullable: true })
  precio!: string;

  @Column({ nullable: true })
  moneda!: string;

  @Column({ nullable: true })
  expensas!: string;

  @Column({ nullable: true })
  calle!: string;

  @Column({ nullable: true })
  altura!: string;

  @Column({ nullable: true })
  barrio!: string;

  @Column({ nullable: true })
  localidad!: string;

  @Column({ nullable: true })
  m2T!: string;

  @Column({ nullable: true })
  m2C!: string;

  @Column({ nullable: true })
  ambientes!: string;

  @Column({ nullable: true })
  dormitorios!: string;

  @Column({ nullable: true })
  banios!: string;

  @Column({ nullable: true })
  cocheras!: string;

  @Column({ nullable: true })
  antiguedad!: string;

  @CreateDateColumn()
  createdAt!: Date;
}
