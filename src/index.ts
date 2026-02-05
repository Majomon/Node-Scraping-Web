import express from "express";
import { AppDataSource } from "./database/data-source";
import { ScraperService } from "./services/ScraperService";

const app = express();
const port = process.env.PORT || 3000;

app.use(express.json());

// Endpoint para disparar el scraping manualmente
app.post("/scrape", async (req, res) => {
  const scraper = new ScraperService();
  scraper.runScraper(); // Lo corremos en background
  res.json({ message: "Scraping iniciado en segundo plano" });
});

app.get("/health", (req, res) => {
  res.json({ status: "ok" });
});

AppDataSource.initialize()
  .then(() => {
    console.log("Base de Datos conectada - Supabase");
    app.listen(port, () => {
      console.log(`Servidor corriendo en http://localhost:${port}`);
    });
  })
  .catch((error) => console.log("Error de conexión:", error));

export default app;
