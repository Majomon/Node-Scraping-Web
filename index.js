const { chromium } = require("playwright-extra");
const stealth = require("puppeteer-extra-plugin-stealth")();
const XLSX = require("xlsx");
const fs = require("fs");

chromium.use(stealth);

const BASE_URL = "https://www.zonaprop.com.ar";
const AGENCY_URL =
  "https://www.zonaprop.com.ar/inmobiliarias/gimenez-inmuebles_17062722-inmuebles.html";
const OUTPUT_FILE = "propiedades_gimenez.xlsx";

// Columnas solicitadas (limpiadas y ordenadas)
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

    await page.goto(url, { waitUntil: "domcontentloaded", timeout: 35000 });

    try {
      await page.waitForSelector(".price-value, .icon-feature", {
        timeout: 15000,
      });
    } catch (e) {}

    const content = await page.content();
    let data = null;

    // 1. Intentar capturar JSON del estado inicial (para datos limpios)
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
      // Mapeo desde JSON
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

    // 2. SCRAPING DE DOM (Para corregir moneda y capturar clases específicas de características)
    const domData = await page.evaluate(() => {
      const getTxt = (sel) =>
        document.querySelector(sel)?.innerText?.trim() || "";

      // Detección refinada de Precio, Moneda y Operación
      const priceEl = document.querySelector(".price-value");
      let operacion = "";
      let moneda = "ARS"; // Default
      let monto = "";

      if (priceEl) {
        const fullPriceText = priceEl.innerText.trim();
        // El primer span suele ser "Venta" o "Alquiler"
        operacion = priceEl.querySelector("span")?.innerText.trim() || "";

        if (fullPriceText.includes("USD") || fullPriceText.includes("U$S")) {
          moneda = "USD";
        } else if (fullPriceText.includes("$")) {
          moneda = "ARS";
        }
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

    // REFINAMIENTO FINAL DE DATOS
    if (!prop["moneda"] || prop["moneda"] === "ARS")
      prop["moneda"] = domData.moneda;

    // Limpieza de la operación para quedarnos solo con el tipo (Venta/Alquiler)
    // Usamos un split que corta en cuanto encuentra un símbolo de moneda o un número
    let rawOp = prop["operacion"] || domData.operacion || "";
    prop["operacion"] = rawOp.split(/USD|U\$S|\$|\d/i)[0].trim();

    // Limpieza de precio y expensas para que solo tengan números
    let finalPrecio = prop["precio"] || domData.precio || "";
    prop["precio"] = String(finalPrecio).replace(/[^\d]/g, "");

    let finalExpensas = prop["expensas"] || domData.expensas || "";
    prop["expensas"] = String(finalExpensas).replace(/[^\d]/g, "");

    // Dirección
    if (!prop["calle"] && domData.fullAddress) {
      const parts = domData.fullAddress.split(",").map((p) => p.trim());
      if (parts.length > 0) {
        prop["calle"] = parts[0].replace(/\d+.*/, "").trim();
        prop["altura"] = parts[0].match(/\d+/)?.[0] || "";
      }
      if (parts.length > 1) prop["barrio"] = parts[1];
      if (parts.length > 2) prop["localidad"] = parts[2];
    }

    // Características técnicas
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

  console.log(`Accediendo a la agencia: ${AGENCY_URL}`);
  await page.goto(AGENCY_URL, {
    waitUntil: "domcontentloaded",
    timeout: 60000,
  });

  let propertyUrls = new Set();
  let hasNextPage = true;

  while (hasNextPage) {
    console.log("Extrayendo lista de propiedades...");
    try {
      await page.waitForSelector(
        "a[data-to-posting], a[href*='/propiedades/']",
        { timeout: 30000 },
      );
    } catch (e) {}

    const links = await page.$$eval(
      "a[data-to-posting], a[href*='/propiedades/']",
      (anchors) => anchors.map((a) => a.getAttribute("href")),
    );

    links.forEach((link) => {
      if (link && !link.includes("inmobiliarias") && link.includes(".html")) {
        const fullUrl = link.startsWith("/") ? BASE_URL + link : link;
        propertyUrls.add(fullUrl);
      }
    });

    console.log(`Propiedades encontradas: ${propertyUrls.size}`);

    const nextButton = await page.$("a[data-qa='paging-next']");
    if (nextButton) {
      const isDisabled = await nextButton.getAttribute("disabled");
      if (isDisabled !== null) {
        hasNextPage = false;
      } else {
        await nextButton.click();
        await new Promise((r) => setTimeout(r, 4000));
      }
    } else {
      hasNextPage = false;
    }
  }

  console.log(`\nIniciando extracción de ${propertyUrls.size} propiedades...`);
  const results = [];
  const urlsArray = Array.from(propertyUrls);

  for (let i = 0; i < urlsArray.length; i++) {
    const url = urlsArray[i];
    const details = await getPropertyDetails(page, url);
    if (details) {
      results.push(details);
      console.log(
        `[${i + 1}/${urlsArray.length}] - ${details.precio} ${details.moneda} - ${details.operacion}`,
      );
    }
    await new Promise((r) => setTimeout(r, 2000));
  }

  if (results.length > 0) {
    const worksheet = XLSX.utils.json_to_sheet(results, { header: COLUMNS });
    const workbook = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(workbook, worksheet, "Propiedades");
    XLSX.writeFile(workbook, OUTPUT_FILE);
    console.log(`\n¡Éxito! Archivo generado en: ${OUTPUT_FILE}`);
  } else {
    console.log("\nNo se pudieron extraer datos.");
  }

  await browser.close();
}

run().catch((err) => console.error("Error crítico:", err));
