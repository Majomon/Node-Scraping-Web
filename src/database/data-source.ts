import "reflect-metadata";
import { DataSource } from "typeorm";
import { Property } from "../entities/Property";
import * as dotenv from "dotenv";

dotenv.config();

export const AppDataSource = new DataSource({
  type: "postgres",
  url: process.env.DATABASE_URL,
  synchronize: true, // Auto-crea las tablas (útil para desarrollo)
  logging: false,
  entities: [Property],
  migrations: [],
  subscribers: [],
  ssl: {
    rejectUnauthorized: false, // Requerido para Supabase
  },
});
