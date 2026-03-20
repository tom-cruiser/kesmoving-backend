const logger = require('../utils/logger');

/**
 * AI Chatbot Service — Hybrid AI Strategy
 *
 * Primary:  OpenRouter (stepfun/step-3.5-flash:free) with streaming.
 *           The model self-reports a confidence score (0–1).
 *           Confidence < 70 % → automatic human handoff.
 * Fallback: Intent-based pattern matching (no API key required).
 *
 * Hard override: explicit escalation keywords always hand off immediately,
 * regardless of provider or confidence level.
 */

const ESCALATION_THRESHOLD = 0.70;   // < 70 % → route to human agent

const ESCALATION_KEYWORDS = [
  'human', 'agent', 'person', 'manager', 'speak to someone', 'real person',
  'complaint', 'legal', 'sue', 'refund', 'angry', 'frustrated', 'unacceptable',
];

// ─── System prompt for OpenRouter ─────────────────────────────────────────────
const SYSTEM_PROMPT = `You are KesBot, the professional AI customer support assistant for Kesmoving — a premium moving and logistics company in Canada.

You help clients with:
- Booking status and updates
- Pricing, quotes, and estimates  
- Scheduling, rescheduling, and cancellations
- Real-time GPS truck tracking (via the Tracking dashboard)
- Payment questions and invoices
- General service inquiries

Guidelines:
- Respond warmly, concisely, and professionally (2–4 sentences max)
- When booking context is provided, reference it directly
- Never invent information — if uncertain, escalate to a human agent
- For complaints, legal threats, or refund requests, always escalate

IMPORTANT: Respond ONLY with valid JSON — no markdown fences, no extra text:
{
  "reply": "<your response to the customer>",
  "confidence": <float 0.0–1.0 representing your certainty in this answer>,
  "intent": "<one of: booking_status|pricing|scheduling|tracking|payment|services|complaint|greeting|general|unknown>",
  "shouldEscalate": <true|false>,
  "escalationReason": "<brief reason if escalating, otherwise null>"
}

Escalation rules — set shouldEscalate: true when:
- confidence is below ${ESCALATION_THRESHOLD}
- customer asks for a human agent, complains, mentions legal action or refunds
- you cannot provide a confident, accurate answer`;

// ─── OpenRouter streaming call ─────────────────────────────────────────────────

function buildHistory(conversation) {
  if (!conversation?.messages?.length) return [];
  return conversation.messages
    .map((msg) => ({
      role: msg.senderType === 'Client' ? 'user' : 'assistant',
      content: msg.content,
    }));
}

async function generateHandoffSummary(transcript, conversation) {
  const fallback = `Summary of human intervention:\n${transcript.slice(0, 1800)}`;

  if (!process.env.OPENROUTER_API_KEY) {
    return fallback;
  }

  try {
    const { default: OpenAI } = await import('openai');
    const client = new OpenAI({
      apiKey: process.env.OPENROUTER_API_KEY,
      baseURL: 'https://openrouter.ai/api/v1',
      defaultHeaders: {
        'HTTP-Referer': process.env.CLIENT_URL || 'https://kesmoving.ca',
        'X-Title': 'Kesmoving Support Bot',
      },
    });

    const bookingHint = conversation?.booking
      ? `Booking: ${conversation.booking.bookingNumber || conversation.booking._id}`
      : 'No active booking provided';

    const completion = await client.chat.completions.create({
      model: 'stepfun/step-3.5-flash:free',
      messages: [
        {
          role: 'system',
          content: 'Summarize this resolved human-support intervention for an AI assistant. Keep under 10 bullet points, include user issue, what agent explained, concrete commitments, and any unresolved risks.',
        },
        {
          role: 'user',
          content: `${bookingHint}\n\nTranscript:\n${transcript}`,
        },
      ],
      max_tokens: 400,
      stream: false,
    });

    const summary = completion.choices?.[0]?.message?.content?.trim();
    return summary || fallback;
  } catch (err) {
    logger.warn(`CHATBOT: Failed to generate handoff summary (${err.message}), using fallback`);
    return fallback;
  }
}

async function processWithOpenRouter(message, conversation) {
  const { default: OpenAI } = await import('openai');
  const client = new OpenAI({
    apiKey: process.env.OPENROUTER_API_KEY,
    baseURL: 'https://openrouter.ai/api/v1',
    defaultHeaders: {
      'HTTP-Referer': process.env.CLIENT_URL || 'https://kesmoving.ca',
      'X-Title': 'Kesmoving Support Bot',
    },
  });

  let systemPrompt = SYSTEM_PROMPT;
  if (conversation?.booking) {
    const b = conversation.booking;
    systemPrompt += `\n\nActive booking context — Number: ${b.bookingNumber || b._id}, Status: ${b.status || 'Unknown'}.`;
  }
  if (conversation?.aiContextSummary) {
    systemPrompt += `\n\nHandoff summary from prior human support session:\n${conversation.aiContextSummary}`;
  }
  if (conversation?.status === 'WaitingForAgent') {
    systemPrompt += `\n\nNote: this client has been queued for a human agent. Acknowledge the wait briefly, then still try to answer their question. Do NOT set shouldEscalate: true unless the user is expressing new frustration.`;
  }

  // Stream the response so reasoning tokens are surfaced in usage
  const stream = await client.chat.completions.create({
    model: 'stepfun/step-3.5-flash:free',
    messages: [
      { role: 'system', content: systemPrompt },
      ...buildHistory(conversation),
      { role: 'user', content: message },
    ],
    stream: true,
    max_tokens: 600,
  });

  let fullResponse = '';
  let reasoningTokens = 0;

  for await (const chunk of stream) {
    const content = chunk.choices[0]?.delta?.content;
    if (content) fullResponse += content;
    if (chunk.usage?.reasoningTokens) reasoningTokens = chunk.usage.reasoningTokens;
  }

  logger.debug(`CHATBOT (OpenRouter) reasoning_tokens=${reasoningTokens} raw=${fullResponse.substring(0, 200)}`);

  // Extract JSON from the model output (handles potential markdown wrapping)
  const jsonMatch =
    fullResponse.match(/```(?:json)?\s*([\s\S]*?)```/) ||
    fullResponse.match(/(\{[\s\S]*\})/s);

  if (!jsonMatch) throw new Error('No JSON found in OpenRouter response');

  const parsed = JSON.parse(jsonMatch[1].trim());
  const confidence = typeof parsed.confidence === 'number'
    ? Math.min(1, Math.max(0, parsed.confidence))
    : 0.5;

  const shouldEscalate = parsed.shouldEscalate === true || confidence < ESCALATION_THRESHOLD;

  return {
    reply: parsed.reply ||
      "I'm having trouble with that request. Let me connect you with a team member.",
    confidence,
    intent: parsed.intent || 'general',
    shouldEscalate,
    escalationReason: parsed.escalationReason ||
      (confidence < ESCALATION_THRESHOLD
        ? `Low AI confidence (${Math.round(confidence * 100)}%)`
        : null),
    provider: 'openrouter',
  };
}

// ─── Fallback: Intent-Based Pattern Matching ──────────────────────────────────
// Used when OPENROUTER_API_KEY is not configured (development / offline mode).

const intents = [
  {
    name: 'booking_status',
    patterns: ['where is my booking', 'booking status', 'what happened to my booking', 'check my booking', 'track my booking'],
    response: (ctx) =>
      ctx.booking
        ? `Your booking ${ctx.booking.bookingNumber} is currently **${ctx.booking.status}**. ${getStatusDetail(ctx.booking.status)}`
        : "I'd be happy to check your booking status! Could you share your booking number?",
    confidence: 0.85,
  },
  {
    name: 'pricing',
    patterns: ['how much', 'price', 'cost', 'estimate', 'quote', 'rates', 'pricing'],
    response: () =>
      "Our pricing is based on the size of your move, distance, and any special requirements. You can get an AI-powered estimate by uploading photos of your items when creating a booking. Would you like to start a booking?",
    confidence: 0.82,
  },
  {
    name: 'scheduling',
    patterns: ['reschedule', 'change date', 'move date', 'postpone', 'cancel'],
    response: () =>
      "To reschedule or cancel your booking, please contact our operations team. If your move is more than 72 hours away, we can generally accommodate date changes. Would you like me to connect you with a team member?",
    confidence: 0.78,
  },
  {
    name: 'services',
    patterns: ['what do you offer', 'services', 'what can you do', 'do you pack', 'packing'],
    response: () =>
      "Kesmoving offers: **Residential Moving**, **Commercial Moving**, **Long Distance Moving**, and **Storage Solutions**. We also provide optional packing and unpacking services. What type of move are you planning?",
    confidence: 0.88,
  },
  {
    name: 'tracking',
    patterns: ['where is my truck', 'track', 'driver location', 'when will they arrive', 'eta'],
    response: () =>
      "You can track your truck in real time from the **Tracking** section of your dashboard once your move is in progress. Your driver's GPS location updates every 30 seconds. Would you like me to open tracking for you?",
    confidence: 0.83,
  },
  {
    name: 'greeting',
    patterns: ['hello', 'hi', 'hey', 'good morning', 'good afternoon', 'help me', 'help'],
    response: () =>
      "Hello! I'm KesBot, Kesmoving's virtual assistant. I can help you with booking status, pricing, scheduling, tracking, and more. How can I assist you today?",
    confidence: 0.95,
  },
  {
    name: 'payment',
    patterns: ['payment', 'pay', 'invoice', 'bill', 'charge', 'receipt'],
    response: () =>
      "Payments at Kesmoving are processed after your move is completed. Our team will provide you with an invoice. If you have questions about a specific charge, I can connect you with our billing team.",
    confidence: 0.80,
  },
];

function getStatusDetail(status) {
  const details = {
    Pending: "Our team is reviewing your request and will confirm shortly.",
    Confirmed: "Your booking is confirmed! We're scheduling your crew.",
    Scheduled: "Your crew has been assigned and your move is scheduled.",
    InProgress: "Your move is underway! Check the Tracking tab to see your truck's live location.",
    Completed: "Your move is complete! Please leave a review to share your experience.",
    Cancelled: "Your booking was cancelled. Contact us if you'd like to rebook.",
  };
  return details[status] || '';
}

function processWithIntents(message, conversation) {
  const lower = message.toLowerCase();
  const ctx = { booking: conversation?.booking };

  const intent = intents.find((i) => i.patterns.some((p) => lower.includes(p)));

  if (!intent) {
    return {
      reply: "I'm not sure I understand your question. Let me connect you with one of our team members who can help.",
      confidence: 0.45,
      intent: 'unknown',
      shouldEscalate: true,
      escalationReason: 'Could not match intent',
      provider: 'intent',
    };
  }

  const reply = typeof intent.response === 'function' ? intent.response(ctx) : intent.response;
  const shouldEscalate = intent.confidence < ESCALATION_THRESHOLD;

  return {
    reply,
    confidence: intent.confidence,
    intent: intent.name,
    shouldEscalate,
    escalationReason: shouldEscalate ? `Low intent confidence (${Math.round(intent.confidence * 100)}%)` : null,
    provider: 'intent',
  };
}

// ─── Main Entry Point ──────────────────────────────────────────────────────────

/**
 * Process a customer message and return a bot reply with metadata.
 *
 * Strategy (in priority order):
 *  1. Keyword override  → immediate escalation regardless of provider
 *  2. OpenRouter AI     → streams stepfun/step-3.5-flash; escalates if confidence < 70 %
 *  3. Intent fallback   → pattern matching when no API key is present
 */
async function processMessage(message, conversation) {
  try {
    // 1. Hard keyword override — always escalate immediately
    const lower = message.toLowerCase();
    if (ESCALATION_KEYWORDS.some((k) => lower.includes(k))) {
      return {
        reply: "I understand this needs personal attention. Let me connect you with one of our team members right away.",
        confidence: 1.0,
        intent: 'escalation',
        shouldEscalate: true,
        escalationReason: 'User requested human agent or indicated frustration',
        provider: 'keyword',
      };
    }

    // 2. OpenRouter AI (preferred when API key is configured)
    if (process.env.OPENROUTER_API_KEY) {
      logger.info('CHATBOT: Using OpenRouter (stepfun/step-3.5-flash:free)');
      try {
        // Race the AI call against a 12-second timeout so a slow free-tier
        // model never blocks the HTTP response indefinitely.
        const timeout = new Promise((_, reject) =>
          setTimeout(() => reject(new Error('OpenRouter timeout after 12s')), 12000)
        );
        const result = await Promise.race([processWithOpenRouter(message, conversation), timeout]);
        logger.info(`CHATBOT: confidence=${Math.round(result.confidence * 100)}% intent=${result.intent} escalate=${result.shouldEscalate}`);
        return result;
      } catch (aiErr) {
        logger.warn(`CHATBOT: OpenRouter error (${aiErr.message}) — falling back to intent matching`);
      }
    } else {
      logger.debug('CHATBOT: No OPENROUTER_API_KEY configured — using intent matching');
    }

    // 3. Intent-based fallback
    return processWithIntents(message, conversation);

  } catch (err) {
    logger.error(`Chatbot fatal error: ${err.message}`);
    return {
      reply: "I'm experiencing technical difficulties. Let me connect you with a team member.",
      confidence: 0.0,
      intent: 'error',
      shouldEscalate: true,
      escalationReason: 'Chatbot error',
    };
  }
}

module.exports = { processMessage, generateHandoffSummary };
