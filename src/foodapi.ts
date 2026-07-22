import { requestUrl } from "obsidian";

/** A normalized food product from Open Food Facts (values per 100 g). */
export interface FoodResult {
  name: string;
  brand: string;
  kcal100: number;
  protein100?: number;
  carbs100?: number;
  fat100?: number;
  servingSize?: string;
}

// Identify the app per Open Food Facts usage guidelines.
const USER_AGENT = "Momentum-Obsidian/0.2.10 (github.com/jnagase/obsidian-momentum)";
const BASE = "https://world.openfoodfacts.org";

const num = (v: unknown): number => {
  const n = typeof v === "string" ? parseFloat(v) : (v as number);
  return Number.isFinite(n) ? n : 0;
};
const round1 = (v: unknown): number | undefined => {
  const n = num(v);
  return n > 0 ? Math.round(n * 10) / 10 : undefined;
};

interface OFFProduct {
  product_name?: string;
  brands?: string;
  serving_size?: string;
  nutriments?: Record<string, unknown>;
}

function mapProduct(p: OFFProduct): FoodResult | null {
  const name = (p.product_name || "").trim();
  if (!name) return null;
  const n = p.nutriments || {};
  const kcal100 = Math.round(num(n["energy-kcal_100g"] ?? n["energy-kcal"]));
  if (kcal100 <= 0) return null;
  return {
    name,
    brand: (p.brands || "").split(",")[0]?.trim() || "",
    kcal100,
    protein100: round1(n["proteins_100g"]),
    carbs100: round1(n["carbohydrates_100g"]),
    fat100: round1(n["fat_100g"]),
    servingSize: (p.serving_size || "").trim(),
  };
}

/** Search foods by free text. Returns up to `limit` results with calories known. */
export async function searchFoods(query: string, limit = 20): Promise<FoodResult[]> {
  const q = query.trim();
  if (!q) return [];
  const fields = "product_name,brands,nutriments,serving_size";
  const url = `${BASE}/cgi/search.pl?search_terms=${encodeURIComponent(q)}&search_simple=1&action=process&json=1&page_size=${limit}&fields=${fields}`;
  const res = await requestUrl({ url, headers: { "User-Agent": USER_AGENT } });
  const data = res.json as { products?: OFFProduct[] };
  const products = data.products || [];
  const seen = new Set<string>();
  const out: FoodResult[] = [];
  for (const p of products) {
    const m = mapProduct(p);
    if (!m) continue;
    const key = `${m.name.toLowerCase()}|${m.brand.toLowerCase()}`;
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(m);
  }
  return out;
}

/** Look up a single product by barcode (EAN/UPC). */
export async function lookupBarcode(barcode: string): Promise<FoodResult | null> {
  const code = barcode.replace(/\D/g, "");
  if (!code) return null;
  const url = `${BASE}/api/v2/product/${code}.json?fields=product_name,brands,nutriments,serving_size`;
  const res = await requestUrl({ url, headers: { "User-Agent": USER_AGENT } });
  const data = res.json as { status?: number; product?: OFFProduct };
  if (data.status !== 1 || !data.product) return null;
  return mapProduct(data.product);
}
