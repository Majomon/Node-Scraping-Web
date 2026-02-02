const { chromium } = require("playwright-extra");
const stealth = require("puppeteer-extra-plugin-stealth")();
const XLSX = require("xlsx");
const fs = require("fs");

chromium.use(stealth);

const BASE_URL = "https://www.zonaprop.com.ar";
const AGENCY_URL =
  "https://www.zonaprop.com.ar/inmobiliarias/gimenez-inmuebles_17062722-inmuebles.html";
const OUTPUT_FILE = "propiedades_gimenez.xlsx";

// Columnas finales solicitadas
const COLUMNS = [
  "id",
  "url",
  "operacion",
  "precio",
  "moneda",
  "expensas",
  "calle",
  "altura",
  "barrio",
  "localidad",
  "m2T",
  "m2C",
  "ambientes",
  "dormitorios",
  "banios",
  "cocheras",
  "antiguedad",
];

async function getPropertyDetails(page, url) {
  try {
    console.log(`Scrapeando detalle: ${url}`);
    await page.goto(url, { waitUntil: "domcontentloaded", timeout: 40000 });

    try {
      await page.waitForSelector(".price-value, .icon-feature", {
        timeout: 15000,
      });
    } catch (e) {}

    const content = await page.content();
    let data = null;

    data = await page.evaluate(() => {
      const state =
        window.__INITIAL_STATE__ || window.__NEXT_DATA__?.props?.pageProps;
      if (state) {
        return (
          state.posting?.posting ||
          state.postingData ||
          state.post?.posting ||
          state.posting ||
          state.project
        );
      }
      return null;
    });

    const prop = {};
    COLUMNS.forEach((col) => (prop[col] = ""));
    prop["url"] = url;
    prop["id"] = url.match(/(\d+)\.html/)?.[1] || "";

    if (data) {
      prop["operacion"] = data.operationType?.name || "";
      prop["precio"] = data.price?.amount || "";
      prop["moneda"] = data.price?.currency || "";
      if (prop["moneda"] === "USD" || prop["moneda"] === "U$S")
        prop["moneda"] = "USD";
      else if (prop["moneda"] === "$") prop["moneda"] = "ARS";
      prop["expensas"] = data.price?.expenses || "";

      const loc = data.location || {};
      const addr = loc.address || {};
      prop["calle"] = addr.street || "";
      prop["altura"] = addr.number || "";
      prop["barrio"] = addr.neighborhood || "";
      prop["localidad"] = addr.city || loc.city?.name || "";

      const f = data.mainFeatures || {};
      prop["m2C"] = f.coveredArea?.value || "";
      prop["m2T"] = f.totalArea?.value || "";
      prop["ambientes"] = f.rooms?.value || "";
      prop["dormitorios"] = f.bedrooms?.value || "";
      prop["banios"] = f.bathrooms?.value || "";
      prop["cocheras"] = f.parkingLots?.value || "";
      prop["antiguedad"] = f.age?.value || "";
    }

    const domData = await page.evaluate(() => {
      const getTxt = (sel) =>
        document.querySelector(sel)?.innerText?.trim() || "";
      const priceEl = document.querySelector(".price-value");
      let operacion = "",
        moneda = "ARS",
        monto = "";

      if (priceEl) {
        const fullPriceText = priceEl.innerText.trim();
        operacion = priceEl.querySelector("span")?.innerText.trim() || "";
        if (fullPriceText.includes("USD") || fullPriceText.includes("U$S"))
          moneda = "USD";
        else if (fullPriceText.includes("$")) moneda = "ARS";
        monto = fullPriceText.replace(/[^\d]/g, "");
      }

      const getValByIcon = (iconClass) => {
        const icon = document.querySelector(
          `.icon-feature i.${iconClass}, .icon-feature .${iconClass}`,
        );
        return icon ? icon.closest(".icon-feature").innerText.trim() : "";
      };

      return {
        operacion,
        moneda,
        precio: monto,
        expensas: getTxt(".price-expenses"),
        fullAddress:
          getTxt(".section-location-property") || getTxt(".title-address"),
        m2T: getValByIcon("icon-stotal"),
        m2C: getValByIcon("icon-scubierta"),
        ambientes: getValByIcon("icon-ambiente"),
        dormitorios: getValByIcon("icon-dormitorio"),
        banios: getValByIcon("icon-bano"),
        cocheras: getValByIcon("icon-cochera"),
        antiguedad: getValByIcon("icon-antiguedad"),
      };
    });

    if (!prop["moneda"] || prop["moneda"] === "ARS")
      prop["moneda"] = domData.moneda;
    let rawOp = prop["operacion"] || domData.operacion || "";
    prop["operacion"] = rawOp.split(/USD|U\$S|\$|\d/i)[0].trim();
    prop["precio"] = String(prop["precio"] || domData.precio).replace(
      /[^\d]/g,
      "",
    );
    prop["expensas"] = String(prop["expensas"] || domData.expensas).replace(
      /[^\d]/g,
      "",
    );

    if (!prop["calle"] && domData.fullAddress) {
      const parts = domData.fullAddress.split(",").map((p) => p.trim());
      if (parts.length > 0) {
        prop["calle"] = parts[0].replace(/\d+.*/, "").trim();
        prop["altura"] = parts[0].match(/\d+/)?.[0] || "";
      }
      if (parts.length > 1) prop["barrio"] = parts[1];
      if (parts.length > 2) prop["localidad"] = parts[2];
    }

    const parseNum = (txt) => (txt.match(/\d+/) ? txt.match(/\d+/)[0] : "");
    if (!prop["m2T"]) prop["m2T"] = parseNum(domData.m2T);
    if (!prop["m2C"]) prop["m2C"] = parseNum(domData.m2C);
    if (!prop["ambientes"]) prop["ambientes"] = parseNum(domData.ambientes);
    if (!prop["dormitorios"])
      prop["dormitorios"] = parseNum(domData.dormitorios);
    if (!prop["banios"]) prop["banios"] = parseNum(domData.banios);
    if (!prop["cocheras"]) prop["cocheras"] = parseNum(domData.cocheras);
    if (!prop["antiguedad"]) prop["antiguedad"] = domData.antiguedad;

    return prop;
  } catch (error) {
    console.error(`Error en ${url}:`, error.message);
    return null;
  }
}

async function run() {
  const browser = await chromium.launch({
    headless: false,
    args: ["--disable-blink-features=AutomationControlled", "--no-sandbox"],
  });
  const context = await browser.newContext({
    userAgent:
      "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36",
    viewport: { width: 1280, height: 800 },
  });
  const page = await context.newPage();

  let propertyUrls = new Set();
  let pageNum = 1;
  let consecutiveEmptyPages = 0;

  console.log("Iniciando recolección de URLs de todas las páginas...");

  while (pageNum <= 20) {
    // Límite de seguridad de 20 páginas
    const currentUrl =
      pageNum === 1
        ? AGENCY_URL
        : AGENCY_URL.replace(".html", `-pagina-${pageNum}.html`);

    console.log(`Accediendo a la página ${pageNum}: ${currentUrl}`);

    try {
      await page.goto(currentUrl, {
        waitUntil: "domcontentloaded",
        timeout: 60000,
      });
      await page.waitForTimeout(4000); // Esperar a que carguen los resultados

      const links = await page.$$eval(
        "a[data-to-posting], a[href*='/propiedades/']",
        (anchors) => anchors.map((a) => a.getAttribute("href")),
      );

      let newLinksFound = 0;
      links.forEach((link) => {
        if (link && !link.includes("inmobiliarias") && link.includes(".html")) {
          const fullUrl = link.startsWith("/") ? BASE_URL + link : link;
          if (!propertyUrls.has(fullUrl)) {
            propertyUrls.add(fullUrl);
            newLinksFound++;
          }
        }
      });

      console.log(
        `Página ${pageNum}: ${newLinksFound} nuevas URLs encontradas (Total: ${propertyUrls.size})`,
      );

      if (newLinksFound === 0) {
        consecutiveEmptyPages++;
      } else {
        consecutiveEmptyPages = 0;
      }

      // Si no encontramos nada nuevo en 2 páginas seguidas, paramos
      if (consecutiveEmptyPages >= 1) {
        console.log(
          "No se encontraron más propiedades nuevas. Finalizando recolección.",
        );
        break;
      }

      pageNum++;
      await new Promise((r) => setTimeout(r, 2000));
    } catch (e) {
      console.error(`Error en página ${pageNum}:`, e.message);
      break;
    }
  }

  console.log(
    `\nExtracción total: ${propertyUrls.size} propiedades encontradas.`,
  );
  const results = [];
  const urlsArray = Array.from(propertyUrls);

  for (let i = 0; i < urlsArray.length; i++) {
    const details = await getPropertyDetails(page, urlsArray[i]);
    if (details) {
      results.push(details);
      console.log(
        `[${i + 1}/${urlsArray.length}] - ${details.precio} ${details.moneda} - ${details.operacion}`,
      );
    }
    await new Promise((r) => setTimeout(r, 2000 + Math.random() * 1000));
  }

  if (results.length > 0) {
    const worksheet = XLSX.utils.json_to_sheet(results, { header: COLUMNS });
    const workbook = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(workbook, worksheet, "Propiedades");
    XLSX.writeFile(workbook, OUTPUT_FILE);
    console.log(
      `\n¡Éxito! Archivo generado: ${OUTPUT_FILE} (${results.length} filas)`,
    );
  }

  await browser.close();
}

run().catch((err) => console.error("Error crítico:", err));
