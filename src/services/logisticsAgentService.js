const { GoogleGenerativeAI } = require("@google/generative-ai");
const { MongoClient } = require("mongodb");
const logger = require("../utils/logger");

// ─── DEFAULT PRICING 2026 (with specialty fees) ───────────────────────────────
const DEFAULT_PRICING_2026 = {
  type: "pricing_2026",
  rates: {
    rate2M: 150,
    rate3M: 210,
  },
  travelHours: 1,
  minimumLaborHours: 3,
  stairsPerFlight: 75,
  fuelRate: 0.12,
  specialtyFees: {
    piano: 500,
    poolTable: 400,
    safe: 300,
  },
  peakDate: {
    start: "06-20",
    end: "07-05",
    multiplier: 1.25,
  },
  taxes: {
    ON: 0.13,
    QC: 0.14975,
    BC: 0.12,
    OTHER: 0.05,
  },
};

// ─── CONSTANTS ────────────────────────────────────────────────────────────────
const PROVINCES = new Set(["ON", "QC", "BC"]);

const REMOTE_PROVINCES = new Set(["NU", "NT", "YT"]);

const REMOTE_ZONES = [
  "IQALUIT",
  "NUNAVUT",
  "NU",
  "YELLOWKNIFE",
  "NORTHWEST TERRITORIES",
  "NT",
  "WHITEHORSE",
  "YUKON",
  "YT",
];

const CITY_TO_PROVINCE_RULES = [
  {
    regex:
      /\b(toronto|mississauga|brampton|markham|vaughan|richmond hill|oakville|gta)\b/i,
    province: "ON",
  },
  {
    regex: /\b(montreal|montréal|laval|quebec city|québec city)\b/i,
    province: "QC",
  },
  {
    regex: /\b(vancouver|burnaby|surrey|richmond\s*,?\s*bc)\b/i,
    province: "BC",
  },
];

const HEAVY_ITEM_REGEX =
  /\b(piano|safe|gym equipment|home gym|treadmill|elliptical|pool table)\b/i;

// ─── UTILITIES ────────────────────────────────────────────────────────────────
function asMoney(value) {
  return Number(Number(value || 0).toFixed(2));
}

function roundToHalf(value) {
  return Math.round(Number(value) * 2) / 2;
}

function clamp(value, min, max) {
  return Math.max(min, Math.min(max, value));
}

function normalizeContent(content) {
  if (typeof content === "string") return content;
  if (Array.isArray(content)) {
    return content
      .map((part) => {
        if (typeof part === "string") return part;
        if (part && typeof part.text === "string") return part.text;
        return "";
      })
      .join("\n")
      .trim();
  }
  return "";
}

function parseJsonResponse(rawText) {
  const fenced = rawText.match(/```(?:json)?\s*([\s\S]*?)```/i);
  const candidate = fenced ? fenced[1] : rawText;
  const objectMatch = candidate.match(/\{[\s\S]*\}/);
  const finalText = objectMatch ? objectMatch[0] : candidate;
  return JSON.parse(finalText);
}

function parseDate(dateText) {
  if (!dateText || typeof dateText !== "string") return null;
  const parsed = new Date(dateText);
  if (Number.isNaN(parsed.getTime())) return null;
  return parsed;
}

function toIsoDateOrEmpty(dateText) {
  const parsed = parseDate(dateText);
  if (!parsed) return "";
  return parsed.toISOString().slice(0, 10);
}

// ─── DETECTION HELPERS ────────────────────────────────────────────────────────
function detectProvinceFromText(text) {
  for (const rule of CITY_TO_PROVINCE_RULES) {
    if (rule.regex.test(text)) return rule.province;
  }
  return null;
}

function detectBedroomsFromText(text) {
  const bedMatch = text.match(/\b([1-9])\s*[- ]?bed(room)?\b/i);
  if (bedMatch) return Number(bedMatch[1]);
  if (/\bstudio\b/i.test(text)) return 1;
  return null;
}

function detectFloorFromText(text) {
  const floorMatch = text.match(
    /\b([1-9]|[1-9][0-9])(?:st|nd|rd|th)?\s*floor\b/i,
  );
  if (floorMatch) return Number(floorMatch[1]);
  return null;
}

function detectElevatorFromText(text, floor) {
  if (/\b(penthouse|high-rise|high rise|elevator)\b/i.test(text)) return true;
  if (/\b(no elevator|without elevator|walk-?up)\b/i.test(text)) return false;
  if (floor >= 2 && /\bfloor\b/i.test(text)) return false;
  return false;
}

function isRemoteLocation(text) {
  if (!text) return false;
  const upper = text.toUpperCase();
  return REMOTE_ZONES.some((zone) => {
    const escaped = zone.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    return new RegExp(`\\b${escaped}\\b`, "i").test(upper);
  });
}

function isRemoteProvince(code) {
  if (!code) return false;
  return REMOTE_PROVINCES.has(code.trim().toUpperCase());
}

function buildTextFromStructured(req) {
  const parts = [];
  if (req.bedrooms) parts.push(`${req.bedrooms}-bedroom`);
  if (req.pickup?.address) parts.push(`from ${req.pickup.address}`);
  if (req.pickup?.floor) parts.push(`from floor ${req.pickup.floor}`);
  if (req.destination?.address) parts.push(`to ${req.destination.address}`);
  if (req.destination?.floor) parts.push(`to floor ${req.destination.floor}`);
  if (req.destination?.elevator === false) parts.push("no elevator");
  if (req.destination?.elevator === true) parts.push("elevator available");
  if (req.move_date) parts.push(`moving on ${req.move_date}`);
  if (req.notes) parts.push(req.notes);
  return parts.join(", ");
}

// ─── HOUR ESTIMATION ─────────────────────────────────────────────────────────
function estimateHoursByStandards({
  bedrooms,
  floor,
  elevator,
  hasHeavyItems,
}) {
  let hours;

  if (bedrooms <= 1) hours = 3.25;
  else if (bedrooms === 2) hours = 5;
  else hours = 8;

  const flights = !elevator && floor > 1 ? floor - 1 : 0;
  hours += flights * 0.5;

  if (hasHeavyItems) hours += 1.5;

  return Math.max(2.5, roundToHalf(hours));
}

function buildReasoning({
  bedrooms,
  floor,
  elevator,
  hasHeavyItems,
  estimatedHours,
}) {
  const parts = [];

  if (bedrooms <= 1) parts.push("Used 1-bedroom baseline (2.5-4h)");
  else if (bedrooms === 2) parts.push("Used 2-bedroom baseline (4-6h)");
  else parts.push("Used 3+ bedroom baseline (6-9+h)");

  if (!elevator && floor > 1) {
    parts.push(
      `Added ${asMoney((floor - 1) * 0.5)}h for ${floor - 1} stair flight(s)`,
    );
  }

  if (hasHeavyItems) parts.push("Added 1.5h for heavy items");

  parts.push(`Final estimate ${estimatedHours}h`);
  return parts.join("; ");
}

// ─── INPUT NORMALIZATION ─────────────────────────────────────────────────────
function normalizeExtractedInputs(extracted, userRequest) {
  const text = String(userRequest || "");

  const bedrooms =
    Number.isFinite(Number(extracted?.bedrooms)) &&
    Number(extracted.bedrooms) > 0
      ? Math.floor(Number(extracted.bedrooms))
      : detectBedroomsFromText(text) || 1;

  const pickupFloor =
    Number.isFinite(Number(extracted?.pickup_floor)) && Number(extracted.pickup_floor) > 0
      ? Math.floor(Number(extracted.pickup_floor))
      : null;

  const destinationFloor =
    Number.isFinite(Number(extracted?.destination_floor)) && Number(extracted.destination_floor) > 0
      ? Math.floor(Number(extracted.destination_floor))
      : null;

  // Backward compat: old single 'floor' field
  const legacyFloor =
    Number.isFinite(Number(extracted?.floor)) && Number(extracted.floor) > 0
      ? Math.floor(Number(extracted.floor))
      : null;

  const detectedFloor = detectFloorFromText(text) || 1;

  // Stair work happens at whichever end has the higher floor
  const floor = Math.max(
    pickupFloor ?? legacyFloor ?? detectedFloor,
    destinationFloor ?? 1,
  );

  const elevator =
    typeof extracted?.elevator === "boolean"
      ? extracted.elevator
      : detectElevatorFromText(text, floor);

  const hasHeavyItems = HEAVY_ITEM_REGEX.test(text);

  // hasPiano: honour AI extraction; fall back to regex on raw text
  const hasPiano =
    typeof extracted?.hasPiano === "boolean"
      ? extracted.hasPiano
      : /\bpiano\b/i.test(text);

  // hasPoolTable / hasSafe for future specialty fee expansion
  const hasPoolTable =
    typeof extracted?.hasPoolTable === "boolean"
      ? extracted.hasPoolTable
      : /\bpool\s*table\b/i.test(text);

  const hasSafe =
    typeof extracted?.hasSafe === "boolean"
      ? extracted.hasSafe
      : /\bsafe\b/i.test(text);

  const estimatedHours = estimateHoursByStandards({
    bedrooms,
    floor,
    elevator,
    hasHeavyItems,
  });

  let province = "";
  if (typeof extracted?.province === "string" && extracted.province.trim()) {
    const candidate = extracted.province.trim().toUpperCase();
    province = PROVINCES.has(candidate) ? candidate : "OTHER";
  } else {
    province = detectProvinceFromText(text) || "ON";
  }

  return {
    bedrooms,
    estimated_hours: estimatedHours,
    floor,
    elevator,
    hasPiano,
    hasPoolTable,
    hasSafe,
    move_date: toIsoDateOrEmpty(extracted?.move_date),
    province,
    reasoning: buildReasoning({
      bedrooms,
      floor,
      elevator,
      hasHeavyItems,
      estimatedHours,
    }),
  };
}

// ─── RESOLVER HELPERS ────────────────────────────────────────────────────────
function isPeakDate(dateValue, pricing) {
  if (!dateValue) return false;
  const month = dateValue.getUTCMonth() + 1;
  const day = dateValue.getUTCDate();
  const mmdd = `${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
  return mmdd >= pricing.peakDate.start && mmdd <= pricing.peakDate.end;
}

function resolveProvince(province, warnings) {
  if (typeof province === "string") {
    const normalized = province.trim().toUpperCase();
    if (PROVINCES.has(normalized)) return normalized;
    if (normalized) {
      warnings.push(
        `Province '${province}' not in ON/QC/BC. Default tax rate 5% applied.`,
      );
      return "OTHER";
    }
  }
  warnings.push("Province missing. Defaulting to ON tax rules.");
  return "ON";
}

function resolveElevator(elevator, warnings) {
  if (typeof elevator === "boolean") return elevator;
  warnings.push(
    "Elevator info missing. Assuming no elevator for stair calculation.",
  );
  return false;
}

function resolveFloor(floor, warnings) {
  const normalized = Number(floor);
  if (!Number.isFinite(normalized) || normalized < 1) {
    warnings.push("Floor missing or invalid. Using floor 1.");
    return 1;
  }
  return Math.floor(normalized);
}

function resolveBedrooms(bedrooms, warnings) {
  const normalized = Number(bedrooms);
  if (!Number.isFinite(normalized) || normalized <= 0) {
    warnings.push("Bedroom count missing. Assuming 1-bedroom (2M rate).");
    return 1;
  }
  return Math.floor(normalized);
}

function resolveEstimatedHours(hours, warnings) {
  const normalized = Number(hours);
  if (!Number.isFinite(normalized) || normalized <= 0) {
    warnings.push("Estimated hours missing. Using minimum labor rule.");
    return 2;
  }
  return normalized;
}

// ─── CORE ESTIMATE CALCULATION ───────────────────────────────────────────────
function calculateEstimate(extracted, pricing) {
  const warnings = [];

  const bedrooms = resolveBedrooms(extracted.bedrooms, warnings);
  const estimatedHours = resolveEstimatedHours(
    extracted.estimated_hours,
    warnings,
  );
  const floor = resolveFloor(extracted.floor, warnings);
  const elevator = resolveElevator(extracted.elevator, warnings);
  const province = resolveProvince(extracted.province, warnings);
  const moveDate = parseDate(extracted.move_date);

  if (!moveDate && extracted.move_date) {
    warnings.push(
      "Move date could not be parsed. Peak surcharge was not applied.",
    );
  }

  const selectedRate =
    bedrooms >= 2 ? pricing.rates.rate3M : pricing.rates.rate2M;
  const totalHours = Math.max(
    pricing.minimumLaborHours,
    estimatedHours + pricing.travelHours,
  );

  const labor = asMoney(totalHours * selectedRate);
  const flights = !elevator && floor > 1 ? floor - 1 : 0;
  const stairs = asMoney(flights * pricing.stairsPerFlight);

  // Specialty fees
  let specialtyTotal = 0;
  if (extracted.hasPiano) specialtyTotal += pricing.specialtyFees.piano ?? 500;
  if (extracted.hasPoolTable)
    specialtyTotal += pricing.specialtyFees.poolTable ?? 400;
  if (extracted.hasSafe) specialtyTotal += pricing.specialtyFees.safe ?? 300;
  specialtyTotal = asMoney(specialtyTotal);

  const fuel = asMoney((labor + stairs) * pricing.fuelRate);
  let subtotal = asMoney(labor + stairs + specialtyTotal + fuel);

  if (moveDate && isPeakDate(moveDate, pricing)) {
    subtotal = asMoney(subtotal * pricing.peakDate.multiplier);
  }

  const taxRate = pricing.taxes[province] ?? pricing.taxes.OTHER;
  const tax = asMoney(subtotal * taxRate);
  const total = asMoney(subtotal + tax);

  const missingSignals = warnings.length;
  const confidence = asMoney(clamp(0.96 - missingSignals * 0.06, 0.5, 0.96));

  return {
    total_cad: total,
    hours: asMoney(totalHours),
    breakdown: {
      labor,
      stairs,
      fuel,
      specialtyTotal,
      tax,
    },
    confidence,
    warnings,
  };
}

// ─── AI EXTRACTION ───────────────────────────────────────────────────────────
async function extractMoveInputs(pricing, rawText) {
  const genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY);
  const model = genAI.getGenerativeModel({ model: "gemini-1.5-flash" });

  const prompt = `ROLE: You are the Kesmoving AI Logistics Analyst.
Goal: translate move descriptions into structured inputs for the 2026 Canadian pricing engine.

PRICING CONTEXT: ${JSON.stringify(pricing)}
Base rates: 2 movers ($150/hr), 3 movers ($210/hr)
Minimum labor: 3 hours total
Efficiency: studio/1-bed 2.5-4h, 2-bed 4-6h, 3-bed+ 6-9+h
Heavy items (piano, safe, gym equipment) add 1.5h
Piano specialty fee: $500. Pool table: $400. Safe: $300.
If destination is IQALUIT, NUNAVUT, YELLOWKNIFE or WHITEHORSE: set confidence 0.1

TASK: Return ONLY this JSON, no markdown:
{
  "bedrooms": number,
  "estimated_hours": number,
  "pickup_floor": number,
  "destination_floor": number,
  "elevator": boolean,
  "hasPiano": boolean,
  "hasPoolTable": boolean,
  "hasSafe": boolean,
  "move_date": "YYYY-MM-DD",
  "province": "ON|QC|BC|OTHER",
  "reasoning": "brief explanation"
}

Rules:
- Toronto/GTA -> ON, Montreal/Laval -> QC, Vancouver/Burnaby -> BC, default ON
- pickup_floor = the floor the move starts FROM (origin building). destination_floor = the floor being moved INTO.
- Stairs penalty uses whichever floor is higher (the harder end). Add +0.5h per stair flight above floor 1.
- 3rd floor + no elevator mention = elevator: false
- penthouse or high-rise = elevator: true
- Add +1.5h for heavy items
- A 4-bedroom house is 800-1200 cu ft, do not underestimate hours
- Return raw JSON only, no markdown fences

Input: ${rawText}`;

  const result = await model.generateContent(prompt);
  const text = result.response.text();
  const jsonMatch = text.match(/```(?:json)?\s*([\s\S]*?)```/) || text.match(/(\{[\s\S]*\})/);
  const jsonStr = jsonMatch ? jsonMatch[1].trim() : text.trim();
  const parsed = JSON.parse(jsonStr);
  return normalizeExtractedInputs(parsed, rawText);
}

// ─── PRICING LOADER ───────────────────────────────────────────────────────────
async function loadPricing(db) {
  const fromDb = await db
    .collection("settings")
    .findOne({ type: "pricing_2026" });
  if (!fromDb) return DEFAULT_PRICING_2026;

  return {
    ...DEFAULT_PRICING_2026,
    ...fromDb,
    rates: {
      ...DEFAULT_PRICING_2026.rates,
      ...(fromDb.rates || {}),
    },
    specialtyFees: {
      ...DEFAULT_PRICING_2026.specialtyFees,
      ...(fromDb.specialtyFees || {}),
    },
    peakDate: {
      ...DEFAULT_PRICING_2026.peakDate,
      ...(fromDb.peakDate || {}),
    },
    taxes: {
      ...DEFAULT_PRICING_2026.taxes,
      ...(fromDb.taxes || {}),
    },
  };
}

// ─── ENTRY POINT ─────────────────────────────────────────────────────────────
async function generateEstimate(userRequest) {
  const client = new MongoClient(
    process.env.MONGODB_URI ||
      process.env.MONGO_URI ||
      "mongodb://localhost:27017/kesmoving",
  );

  try {
    await client.connect();
    const db = client.db(process.env.MONGODB_DB_NAME || "bueccdb");
    const pricing = await loadPricing(db);

    // STEP 1 — detect structured vs string input
    const isStructured = typeof userRequest === "object" && userRequest !== null;
    const rawText = isStructured
      ? buildTextFromStructured(userRequest)
      : String(userRequest || "");

    // STEP 2 — remote-zone check before any AI call
    const destProvince = isStructured
      ? String(userRequest.destination?.province || "").toUpperCase()
      : null;
    const destText = isStructured
      ? String(userRequest.destination?.address || "")
      : rawText;

    if (isRemoteProvince(destProvince) || isRemoteLocation(destText)) {
      const remoteResult = {
        total_cad: 0,
        status: "MANUAL_QUOTE_REQUIRED",
        warnings: [
          "Destination requires air/sea freight. Automated pricing disabled.",
        ],
      };

      await db.collection("estimates").insertOne({
        ...remoteResult,
        userInput: userRequest,
        timestamp: new Date(),
      });

      return remoteResult;
    }

    // STEP 3 — trusted UI overrides from structured payload
    const structuredOverrides = isStructured
      ? {
          bedrooms: userRequest.bedrooms
            ? Number(userRequest.bedrooms)
            : undefined,
          pickup_floor: userRequest.pickup?.floor
            ? Number(userRequest.pickup.floor)
            : undefined,
          destination_floor: userRequest.destination?.floor
            ? Number(userRequest.destination.floor)
            : undefined,
          elevator:
            typeof userRequest.destination?.elevator === "boolean"
              ? userRequest.destination.elevator
              : undefined,
          province: userRequest.destination?.province || undefined,
          move_date: userRequest.move_date || undefined,
          hasPiano: userRequest.hasPiano ?? undefined,
          hasPoolTable: userRequest.hasPoolTable ?? undefined,
          hasSafe: userRequest.hasSafe ?? undefined,
        }
      : {};

    let extracted = {};

    // STEP 4 — AI extraction on rawText, merge overrides before normalization
    let aiExtracted = {};
    if (process.env.GEMINI_API_KEY) {
      try {
        aiExtracted = await extractMoveInputs(pricing, rawText);
      } catch (err) {
        logger.warn(
          `LOGISTICS_AGENT: Gemini extraction failed (${err.message}) — using fallback heuristics.`,
        );
        aiExtracted = {};
      }
    } else {
      logger.warn(
        "LOGISTICS_AGENT: GEMINI_API_KEY missing, using fallback heuristics.",
      );
      aiExtracted = {};
    }

    const mergedRaw = { ...aiExtracted, ...structuredOverrides };
    extracted = normalizeExtractedInputs(mergedRaw, rawText);

    extracted.userInput = rawText;

    const estimate = calculateEstimate(extracted, pricing);

    await db.collection("estimates").insertOne({
      ...estimate,
      userInput: userRequest,
      extractedInput: extracted,
      pricingSource: pricing.type || "pricing_2026",
      timestamp: new Date(),
    });

    return estimate;
  } catch (err) {
    logger.error(`LOGISTICS_AGENT_ERROR: ${err.message}`);
    throw err;
  } finally {
    await client.close();
  }
}

module.exports = { generateEstimate, calculateEstimate };
