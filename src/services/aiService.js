const fs = require('fs');
const path = require('path');
const logger = require('../utils/logger');

/**
 * AI Move Estimation Service
 * Uses OpenAI Vision (GPT-4o) or Gemini to analyze item photos
 * Falls back to a mock estimator when no API key is provided (dev mode)
 */

const TRUCK_SIZES = [
  { label: 'Small Truck', maxVolume: 200, maxWeight: 1500 },
  { label: 'Medium Truck', maxVolume: 400, maxWeight: 3000 },
  { label: 'Large Truck', maxVolume: 700, maxWeight: 6000 },
  { label: 'Extra Large Truck', maxVolume: 1200, maxWeight: 10000 },
];

function recommendTruck(estimatedVolume) {
  for (const truck of TRUCK_SIZES) {
    if (estimatedVolume <= truck.maxVolume) return truck.label;
  }
  return 'Extra Large Truck';
}

function generatePriceEstimate(volume, distance) {
  const baseRate = 120; // CAD per hour
  const fuelRate = 0.85; // CAD per km
  const volumeRate = 0.95; // CAD per cubic foot
  const distKm = distance || 25;
  const hours = Math.max(2, Math.ceil(volume / 80));
  return Math.round(baseRate * hours + fuelRate * distKm + volumeRate * volume);
}

/**
 * Analyzes item photos using OpenRouter (Qwen VL) with streaming
 */
async function analyzeWithOpenRouter(photoUrls) {
  const { default: OpenAI } = await import('openai');
  const client = new OpenAI({
    apiKey: process.env.OPENROUTER_API_KEY,
    baseURL: 'https://openrouter.ai/api/v1',
    defaultHeaders: {
      'HTTP-Referer': process.env.CLIENT_URL || 'https://kesmoving.ca',
      'X-Title': 'Kesmoving AI Estimator',
    },
  });

  const imageContent = photoUrls.slice(0, 10).map((url) => {
    if (url.startsWith('http')) {
      return { type: 'image_url', image_url: { url } };
    }
    const absPath = path.join(__dirname, '../../', url);
    const base64 = fs.readFileSync(absPath).toString('base64');
    const ext = path.extname(url).substring(1) || 'jpeg';
    return { type: 'image_url', image_url: { url: `data:image/${ext};base64,${base64}` } };
  });

  const prompt = `You are a professional moving estimator. Analyze these images of household/commercial items and provide a JSON estimate.

Return ONLY valid JSON in this exact format:
{
  "itemsDetected": ["list of item names"],
  "estimatedVolume": <number in cubic feet>,
  "estimatedWeight": <number in lbs>,
  "loadingTime": <estimated hours as decimal>,
  "aiConfidence": <0.0 to 1.0>,
  "notes": "any special considerations"
}

Base your estimates on what you can see. Be conservative. Common volumes: sofa=35cf, bed=30cf, dresser=20cf, box=2cf, table=15cf.`;

  const stream = await client.chat.completions.create({
    model: 'qwen/qwen3-vl-235b-a22b-thinking',
    messages: [{ role: 'user', content: [{ type: 'text', text: prompt }, ...imageContent] }],
    stream: true,
  });

  let fullText = '';
  for await (const chunk of stream) {
    const content = chunk.choices[0]?.delta?.content;
    if (content) fullText += content;
  }

  // Strip markdown code fences if the model wrapped its JSON
  const jsonMatch = fullText.match(/```(?:json)?\s*([\s\S]*?)```/) || fullText.match(/(\{[\s\S]*\})/);
  const jsonStr = jsonMatch ? jsonMatch[1].trim() : fullText.trim();
  return JSON.parse(jsonStr);
}

/**
 * Analyzes item photos using OpenAI Vision API
 */
async function analyzeWithOpenAI(photoUrls) {
  const { default: OpenAI } = await import('openai');
  const client = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });

  const imageContent = photoUrls.slice(0, 10).map((url) => {
    // Support both absolute URLs and local file paths
    if (url.startsWith('http')) {
      return { type: 'image_url', image_url: { url, detail: 'low' } };
    }
    const absPath = path.join(__dirname, '../../', url);
    const base64 = fs.readFileSync(absPath).toString('base64');
    const ext = path.extname(url).substring(1) || 'jpeg';
    return { type: 'image_url', image_url: { url: `data:image/${ext};base64,${base64}`, detail: 'low' } };
  });

  const prompt = `You are a professional moving estimator. Analyze these images of household/commercial items and provide a JSON estimate.

Return ONLY valid JSON in this exact format:
{
  "itemsDetected": ["list of item names"],
  "estimatedVolume": <number in cubic feet>,
  "estimatedWeight": <number in lbs>,
  "loadingTime": <estimated hours as decimal>,
  "aiConfidence": <0.0 to 1.0>,
  "notes": "any special considerations"
}

Base your estimates on what you can see. Be conservative. Common volumes: sofa=35cf, bed=30cf, dresser=20cf, box=2cf, table=15cf.`;

  const response = await client.chat.completions.create({
    model: 'gpt-4o',
    messages: [{ role: 'user', content: [{ type: 'text', text: prompt }, ...imageContent] }],
    max_tokens: 500,
    response_format: { type: 'json_object' },
  });

  return JSON.parse(response.choices[0].message.content);
}

/**
 * Mock estimator for development (when no API key is set)
 */
function mockEstimate(photoCount) {
  const volume = 20 + photoCount * 15 + Math.floor(Math.random() * 40);
  return {
    itemsDetected: ['sofa', 'bed', 'dining table', 'chairs', 'boxes', 'dresser'].slice(0, 4 + photoCount),
    estimatedVolume: volume,
    estimatedWeight: Math.round(volume * 15),
    loadingTime: Math.max(1.5, Math.round((volume / 80) * 2) / 2),
    aiConfidence: 0.75 + Math.random() * 0.2,
    notes: 'Mock estimate (development mode)',
  };
}

/**
 * Main entry point — analyzes uploaded photos and returns a structured estimate
 */
async function analyzeItems(photoUrls) {
  try {
    let raw;

    if (process.env.OPENROUTER_API_KEY) {
      logger.info('AI_SERVICE: Using OpenRouter (Qwen VL) for image analysis');
      raw = await analyzeWithOpenRouter(photoUrls);
    } else if (process.env.OPENAI_API_KEY && process.env.OPENAI_API_KEY !== 'your_openai_api_key_here') {
      logger.info('AI_SERVICE: Using OpenAI (GPT-4o) for image analysis');
      raw = await analyzeWithOpenAI(photoUrls);
    } else {
      logger.warn('AI_SERVICE: No API key configured — using mock estimator');
      raw = mockEstimate(photoUrls.length);
    }

    const recommendedTruck = recommendTruck(raw.estimatedVolume);
    const estimatedPrice = generatePriceEstimate(raw.estimatedVolume);

    return {
      itemsDetected: raw.itemsDetected || [],
      estimatedVolume: raw.estimatedVolume,
      estimatedWeight: raw.estimatedWeight,
      loadingTime: raw.loadingTime,
      aiConfidence: raw.aiConfidence,
      recommendedTruck,
      estimatedPrice,
      rawAiResponse: raw,
    };
  } catch (err) {
    logger.error(`AI estimation failed: ${err.message}`);
    throw new Error(`AI estimation failed: ${err.message}`);
  }
}

module.exports = { analyzeItems };
