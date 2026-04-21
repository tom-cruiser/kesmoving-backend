const fs = require('fs');
const path = require('path');
const { GoogleGenerativeAI } = require('@google/generative-ai');
const logger = require('../utils/logger');

/**
 * AI Move Estimation Service
 * Uses Gemini to analyze item photos
 * Falls back to a mock estimator when no API key is provided (dev mode)
 */

const TRUCK_SIZES = [
  { label: 'Small Truck', maxVolume: 200, maxWeight: 1500 },
  { label: 'Medium Truck', maxVolume: 400, maxWeight: 3000 },
  { label: 'Large Truck', maxVolume: 700, maxWeight: 6000 },
  { label: 'Extra Large Truck', maxVolume: 1200, maxWeight: 10000 },
];

const MIN_VOLUME_BY_BEDROOMS = { 1: 150, 2: 350, 3: 600, 4: 800 };

function recommendTruck(estimatedVolume) {
  for (const truck of TRUCK_SIZES) {
    if (estimatedVolume <= truck.maxVolume) return truck.label;
  }
  return 'Extra Large Truck';
}

function sanitizeVolume(volume, bedrooms) {
  const beds = Math.min(Number(bedrooms) || 1, 4);
  const floor = MIN_VOLUME_BY_BEDROOMS[beds] || 150;
  if (volume < floor) {
    logger.warn(`AI_SERVICE: Volume ${volume} cu ft too low for ${beds}-bedroom. Clamping to ${floor} cu ft.`);
    return floor;
  }
  return volume;
}

function resolveLocalImagePath(url) {
  const normalized = String(url || '').replace(/^\/+/, '');
  return path.join(__dirname, '../../', normalized);
}

async function analyzeWithGemini(photoUrls, bedrooms) {
  const genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY);
  const model = genAI.getGenerativeModel({ model: 'gemini-1.5-flash' });

  const imageParts = await Promise.all(
    photoUrls.slice(0, 10).map(async (url) => {
      if (url.startsWith('http')) {
        const res = await fetch(url);
        const buffer = await res.arrayBuffer();
        const base64 = Buffer.from(buffer).toString('base64');
        const mimeType = res.headers.get('content-type') || 'image/jpeg';
        return { inlineData: { data: base64, mimeType } };
      }
      const absPath = resolveLocalImagePath(url);
      const base64 = fs.readFileSync(absPath).toString('base64');
      const ext = path.extname(url).substring(1) || 'jpeg';
      return { inlineData: { data: base64, mimeType: `image/${ext}` } };
    }),
  );

  const prompt = `You are a professional moving estimator.
Analyze these images and return ONLY valid JSON with no markdown:
{
  "itemsDetected": ["list of items visible"],
  "estimatedVolume": <cubic feet - a 4-bedroom house is 800-1200 cu ft>,
  "estimatedWeight": <lbs>,
  "loadingTime": <hours as decimal>,
  "aiConfidence": <0.0 to 1.0>,
  "hasPiano": <true if piano visible>,
  "hasPoolTable": <true if pool table visible>,
  "hasSafe": <true if safe visible>,
  "notes": "special considerations"
}
Rules:
- Common volumes: sofa=35cf, bed=30cf, dresser=20cf, box=2cf, table=15cf, grand piano=25cf
- This move is for a ${bedrooms || 1}-bedroom home, minimum expected volume is proportional
- Do NOT return markdown fences. Return raw JSON only.`;

  const result = await model.generateContent([prompt, ...imageParts]);
  const text = result.response.text();
  const jsonMatch = text.match(/```(?:json)?\s*([\s\S]*?)```/) || text.match(/(\{[\s\S]*\})/);
  const jsonStr = jsonMatch ? jsonMatch[1].trim() : text.trim();
  return JSON.parse(jsonStr);
}

/**
 * Mock estimator for development (when no API key is set)
 */
function mockEstimate(photoCount, bedrooms) {
  const beds = Math.min(Number(bedrooms) || 1, 4);
  const baseVolume = MIN_VOLUME_BY_BEDROOMS[beds] || 150;
  const volume = baseVolume + photoCount * 10 + Math.floor(Math.random() * 30);
  return {
    itemsDetected: ['sofa', 'bed', 'dining table', 'chairs', 'boxes', 'dresser'].slice(0, 4 + photoCount),
    estimatedVolume: volume,
    estimatedWeight: Math.round(volume * 15),
    loadingTime: Math.max(1.5, Math.round((volume / 80) * 2) / 2),
    aiConfidence: 0.75 + Math.random() * 0.2,
    hasPiano: false,
    hasPoolTable: false,
    hasSafe: false,
    notes: 'Mock estimate (development mode)',
  };
}

/**
 * Main entry point — analyzes uploaded photos and returns a structured estimate
 */
async function analyzeItems(photoUrls, bedrooms) {
  try {
    let raw;

    if (process.env.GEMINI_API_KEY) {
      logger.info('AI_SERVICE: Using Gemini (gemini-1.5-flash) for image analysis');
      try {
        raw = await analyzeWithGemini(photoUrls, bedrooms);
      } catch (err) {
        logger.warn(`AI_SERVICE: Gemini failed (${err.message}) — falling back to mock estimator`);
        raw = mockEstimate(photoUrls.length, bedrooms);
      }
    } else {
      logger.warn('AI_SERVICE: No API key configured — using mock estimator');
      raw = mockEstimate(photoUrls.length, bedrooms);
    }

    const sanitizedVolume = sanitizeVolume(raw.estimatedVolume, bedrooms);

    return {
      itemsDetected: raw.itemsDetected || [],
      estimatedVolume: sanitizedVolume,
      estimatedWeight: raw.estimatedWeight,
      loadingTime: raw.loadingTime,
      aiConfidence: raw.aiConfidence,
      hasPiano: raw.hasPiano || false,
      hasPoolTable: raw.hasPoolTable || false,
      hasSafe: raw.hasSafe || false,
      recommendedTruck: recommendTruck(sanitizedVolume),
      rawAiResponse: raw,
    };
  } catch (err) {
    logger.error(`AI estimation failed: ${err.message}`);
    throw new Error(`AI estimation failed: ${err.message}`);
  }
}

module.exports = { analyzeItems };
