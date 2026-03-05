/**
 * Classifier Agent: intent + confidence per docs/contracts/intent-taxonomy.md.
 * Canonical implementation is in ai-microservice (POST /api/email-triage/classify).
 * This file is kept for reference only; server.js uses ai-microservice.
 */

const INTENTS = ['support', 'sales', 'contract', 'technical', 'billing', 'spam', 'unknown', 'multi_intent'];

// Keywords (DE/EN) per primary intent — prototype only
const KEYWORDS = {
  billing: /\b(rechnung|invoice|zahlung|payment|kosten|preis|refund|rückerstattung|abbuchung|debit)\b/i,
  contract: /\b(vertrag|contract|kündigung|cancel|änderung|change|agb|terms)\b/i,
  technical: /\b(verbindung|connection|internet|störung|outage|fehler|error|router|modem|technisch)\b/i,
  sales: /\b(angebot|offer|kaufen|buy|tarif|plan|bestellen|order)\b/i,
  spam: /\b(casino|lottery|winner|click here|unsubscribe|opt.?out)\b/i,
  support: /\b(hilfe|help|frage|question|problem|beschwerde|complaint|support)\b/i
};

const DEFAULT_THRESHOLD = 0.75;

/**
 * @param {string} text - Combined subject + body_plain (or stripped body_html)
 * @param {number} threshold - From CLASSIFIER_CONFIDENCE_THRESHOLD env
 * @returns {{ intent: string, confidence: number, raw_scores?: object }}
 */
function classify(text, threshold = DEFAULT_THRESHOLD) {
  const t = (text || '').trim();
  if (!t) {
    return { intent: 'unknown', confidence: 0, raw_scores: {} };
  }

  const raw_scores = {};
  for (const [intent, re] of Object.entries(KEYWORDS)) {
    const matches = t.match(re);
    raw_scores[intent] = matches ? Math.min(0.5 + matches.length * 0.15, 0.95) : 0.2;
  }

  const entries = Object.entries(raw_scores).filter(([, s]) => s > 0.2);
  const byScore = entries.sort((a, b) => b[1] - a[1]);

  if (byScore.length === 0) {
    return { intent: 'unknown', confidence: 0.2, raw_scores };
  }

  const top = byScore[0];
  const second = byScore[1];
  const topScore = top[1];
  const secondScore = second ? second[1] : 0;

  if (topScore >= threshold && secondScore >= threshold) {
    return { intent: 'multi_intent', confidence: (topScore + secondScore) / 2, raw_scores };
  }
  if (topScore < threshold) {
    return { intent: 'unknown', confidence: topScore, raw_scores };
  }

  return {
    intent: top[0],
    confidence: topScore,
    raw_scores
  };
}

/**
 * Get threshold from env (CLASSIFIER_CONFIDENCE_THRESHOLD); default 0.75.
 */
function getConfidenceThreshold() {
  const v = process.env.CLASSIFIER_CONFIDENCE_THRESHOLD;
  if (v === undefined || v === '') return DEFAULT_THRESHOLD;
  const n = Number(v);
  return Number.isFinite(n) && n >= 0 && n <= 1 ? n : DEFAULT_THRESHOLD;
}

module.exports = { classify, getConfidenceThreshold, INTENTS };
