# Intent Taxonomy

Canonical intent labels and rules for the Classifier Agent. Aligned with the business scenario and the ambiguity-handling principles defined in the five design approaches (FIVE_APPROACHES §4).

## Primary Intents (Single-Label)

| Intent | Description |
| ------ | ------------- |
| support | General customer support request. |
| sales | Sales inquiry (product, offer, pricing). |
| contract | Contract question or change request. |
| technical | Technical problem or question. |
| billing | Billing or payment issue. |
| spam | Spam or irrelevant message (no business value). |

## Ambiguity and Edge Cases

| Intent | Description |
| ------ | ------------- |
| unknown | Intent could not be determined (low confidence, unclear language, or missing context). |
| multi_intent | Message clearly contains more than one primary intent (e.g. support + billing). |

## Confidence Thresholds

- **Per-intent threshold:** Minimum confidence to assign a primary intent: configurable via env (e.g. `CLASSIFIER_CONFIDENCE_THRESHOLD`); default 0.75.
- **Below threshold:** Classifier MUST output `unknown` and set confidence to the raw score; downstream action is escalate-by-default per routing rules.
- **Multi-intent:** If two or more primary intents exceed threshold, output `multi_intent`; downstream action is escalate-by-default.

## Fallback Rules

- Missing or malformed email content → treat as `unknown` and escalate (incomplete_data).
- Non-German or multilingual content: classify with same taxonomy; low confidence → `unknown` and escalate. Do not invent new intents.

## Output Contract (Classifier Agent)

- **intent:** One of support | sales | contract | technical | billing | spam | unknown | multi_intent.
- **confidence:** Number in [0, 1].
- **raw_scores:** Optional map of intent → score for audit; no secret data.

## Naming

- No new domain terms. Vocabulary: support, sales, contract, technical, billing, spam, unknown, multi_intent, escalate.
