# Email Triage Tasks Index — Lead Orchestrator

Task index for the Agentic Email Processing System. Used by the Lead Orchestrator to decompose work, assign agents, and enforce sync points. See [docs/agents/master-prompt.md](agents/master-prompt.md).

---

## 1. Global Dependency Graph

```text
Phase 0 (contracts) ──► Sync A (contracts frozen, Validator sign-off)
       │
       ▼
Phase 1 (ingest + classify, parallel) ──► Sync B (classifier/extractor contracts, confidence thresholds)
       │
       ▼
Phase 2 (extract + decide, parallel) ──► Sync C (action/escalation rules, logging schema validated)
       │
       ▼
Phase 3 (act + escalate, sync) ──► Sync D (end-to-end flow, observability checklist approved)
```

**Dependency rules:**

- Phase 1 cannot start until **Sync A** is passed (email schema, intent taxonomy, action set, escalation contracts frozen and validated).
- Phase 2 cannot start until **Sync B** is passed (classifier and extractor contracts and confidence thresholds agreed).
- Phase 3 cannot start until **Sync C** is passed (action/escalation rules and logging schema validated).
- Cutover to production-ready prototype requires **Sync D** (end-to-end flow and observability checklist approved).

---

## 2. Phase 0 — Contracts (Before Any Implementation)

**Objective:** Define and freeze email schema, intent taxonomy, action set, and escalation contracts. No implementation code; contracts only.

### 2.1 Task Group 0.1 — Email and Event Schemas

| Property | Value |
| -------- | ----- |
| Group name | Phase 0.1 — Email and event schemas |
| Can run in parallel? | YES (with 0.2, 0.3, 0.4) |
| Dependencies | None (entry point) |
| Outputs | `docs/contracts/email-schema.md`, `docs/contracts/event-schema.md` |
| Agents count | 1 |

### 2.2 Task Group 0.2 — Intent Taxonomy

| Property | Value |
| -------- | ----- |
| Group name | Phase 0.2 — Intent taxonomy |
| Can run in parallel? | YES |
| Dependencies | None |
| Outputs | `docs/contracts/intent-taxonomy.md` |
| Agents count | 1 |

### 2.3 Task Group 0.3 — Action Set and Routing

| Property | Value |
| -------- | ----- |
| Group name | Phase 0.3 — Action set and routing |
| Can run in parallel? | YES |
| Dependencies | None |
| Outputs | `docs/contracts/action-set.md`, `docs/contracts/routing-rules.md` |
| Agents count | 1 |

### 2.4 Task Group 0.4 — Escalation Contracts

| Property | Value |
| -------- | ----- |
| Group name | Phase 0.4 — Escalation contracts |
| Can run in parallel? | YES |
| Dependencies | None |
| Outputs | `docs/contracts/escalation-contract.md` |
| Agents count | 1 |

### 2.5 Sync A — Contracts Frozen

- **Trigger:** All Phase 0 deliverables (0.1–0.4) are produced.
- **Validator:** Validator Agent (or equivalent) audits deliverables against master-prompt and CREATE_SERVICE rules.
- **Exit criteria:** No hardcoded URLs/keys; naming consistent with business scenario (support, sales, contract, technical, billing, spam, escalate); escalation_reason and confidence in event schema; .env keys referenced only by name in docs.
- **No agent proceeds past Sync A until validation passes.**

---

## 3. Phase 0 — Individual Agent Task Prompts (Copy-Paste Ready)

### 3.1 Agent: Email and Event Schema Author

**Role:** Contract author for email ingestion and event/logging schemas.

**Scope:** Produce the canonical email payload schema and the event schema used for logging and audit. Align with `docs/FIVE_APPROACHES.md` (reliability and observability).

**DO:**

- Define email schema: message_id, tenant_id, timestamp, sender, recipients, subject, body_plain, body_html, attachments (metadata only), and any tenant/context fields. Use business scenario vocabulary only.
- Define event schema for logging: message_id, timestamp, agent, decision, confidence, escalation_reason, and any fields required for audit (see FIVE_APPROACHES and master-prompt). Ensure compatibility with central logging (`LOGGING_SERVICE_URL`).
- Write contracts in `docs/contracts/email-schema.md` and `docs/contracts/event-schema.md`. Create `docs/contracts/` if it does not exist.
- Reference config only by env key names (e.g. `LOGGING_SERVICE_URL`); no hardcoded URLs or secrets.
- Use markdown and clear field types/constraints.

**DO NOT:**

- Add implementation code or scripts.
- Introduce domain terms not in the business scenario (support, sales, contract, technical, billing, spam, escalate).
- Put secret values in any document; only key names in .env.example style.

**Input artifacts:**

- `docs/agents/master-prompt.md`
- `docs/FIVE_APPROACHES.md`
- `README.md`

**Expected output:**

- `docs/contracts/email-schema.md`
- `docs/contracts/event-schema.md`

**Exit criteria:**

- Email schema includes message_id, tenant_id, timestamp, and content fields; event schema includes message_id, timestamp, agent, decision, confidence, escalation_reason. No trailing spaces.

---

### 3.2 Agent: Intent Taxonomy Author

**Role:** Contract author for email intent classification.

**Scope:** Define the intent taxonomy used by the Classifier Agent. Must align with the business scenario and the reasoning captured in the five design approaches.

**DO:**

- Define intent labels: support, sales, contract, technical, billing, spam (or spam/irrelevant). Include “unknown” and “multi-intent” for ambiguity handling (see FIVE_APPROACHES §4).
- Document confidence thresholds per intent (or global) and rules for low-confidence and multi-intent (escalate-by-default).
- Write contract in `docs/contracts/intent-taxonomy.md`. Create `docs/contracts/` if needed.
- Use only business scenario vocabulary; no new domain terms.

**DO NOT:**

- Add implementation code or scripts.
- Omit “unknown” or “multi-intent”; ambiguity handling is mandatory.

**Input artifacts:**

- `docs/agents/master-prompt.md`
- `docs/FIVE_APPROACHES.md`
- `README.md`

**Expected output:**

- `docs/contracts/intent-taxonomy.md`

**Exit criteria:**

- All intents (support, sales, contract, technical, billing, spam/irrelevant, unknown, multi-intent) defined; confidence and fallback rules documented. No trailing spaces.

---

### 3.3 Agent: Action Set and Routing Author

**Role:** Contract author for actions and routing rules.

**Scope:** Define the action set (auto-respond, route to queue, escalate) and routing rules. Align with business-oriented automation (FIVE_APPROACHES §5).

**DO:**

- Define actions: auto-respond, route_to_queue, escalate. Map to business units/SLAs where applicable.
- Document routing rules (which intent/confidence leads to which action). Include criteria for when to auto-respond vs. route vs. escalate.
- Write contracts in `docs/contracts/action-set.md` and `docs/contracts/routing-rules.md`. Create `docs/contracts/` if needed.
- Use only business scenario vocabulary.

**DO NOT:**

- Add implementation code or scripts.
- Introduce actions not agreed in master-prompt (auto-respond, route, escalate).

**Input artifacts:**

- `docs/agents/master-prompt.md`
- `docs/FIVE_APPROACHES.md`
- `README.md`

**Expected output:**

- `docs/contracts/action-set.md`
- `docs/contracts/routing-rules.md`

**Exit criteria:**

- Actions and routing rules clearly defined; mapping to business outcomes documented. No trailing spaces.

---

### 3.4 Agent: Escalation Contract Author

**Role:** Contract author for escalation reasons and human-queue routing.

**Scope:** Define escalation reasons and how they map to human queues. Align with “when in doubt, escalate” and auditability (FIVE_APPROACHES §3, §4).

**DO:**

- Define escalation reason taxonomy (e.g. ambiguous_intent, low_confidence, multi_intent, incomplete_data, policy_sensitive, complaint, contract_change, etc.). Use business scenario and compliance (GDPR, brand).
- Document how escalation reasons map to human queues or handoff contracts.
- Write contract in `docs/contracts/escalation-contract.md`. Create `docs/contracts/` if needed.
- Ensure every escalation is auditable (link to event schema: escalation_reason).

**DO NOT:**

- Add implementation code or scripts.
- Allow “no escalation” path for ambiguous or policy-sensitive cases without explicit business rule.

**Input artifacts:**

- `docs/agents/master-prompt.md`
- `docs/FIVE_APPROACHES.md`
- `docs/contracts/event-schema.md` (if already produced; otherwise event schema requirements from master-prompt)

**Expected output:**

- `docs/contracts/escalation-contract.md`

**Exit criteria:**

- Escalation reasons and queue mapping defined; audit trail requirements satisfied. No trailing spaces.

---

### 3.5 Agent: Validator (Sync A)

**Role:** Audit Phase 0 deliverables and sign off for Sync A.

**Scope:** Run only after all Phase 0.1–0.4 outputs exist. Validate contracts against master-prompt and CREATE_SERVICE rules.

**DO:**

- Verify presence of: `email-schema.md`, `event-schema.md`, `intent-taxonomy.md`, `action-set.md`, `routing-rules.md`, `escalation-contract.md`.
- Check: no hardcoded URLs/keys; only env key names; naming matches business scenario; event schema includes message_id, timestamp, agent, decision, confidence, escalation_reason; intent taxonomy includes unknown and `multi_intent`; routing rules use only actions declared in `action-set.md`; escalation contract links to event schema.
- If violations exist: list them and block Sync A; send tasks back for correction.
- If pass: document sign-off in `docs/contracts/SYNC_A_VALIDATION.md` (short checklist and “Sync A passed” statement).

**DO NOT:**

- Modify contract content; only validate and approve or reject.
- Proceed to Phase 1 until Sync A is passed.

**Input artifacts:**

- All `docs/contracts/*.md` from Phase 0.1–0.4
- `docs/agents/master-prompt.md`
- `CREATE_SERVICE.md` (repo root)

**Expected output:**

- `docs/contracts/SYNC_A_VALIDATION.md` (checklist + pass/fail)

**Exit criteria:**

- Checklist complete; “Sync A passed” recorded if and only if no violations. No trailing spaces.

---

## 4. Phase 1 — Ingest + Classify (After Sync A)

| Group | Parallel? | Dependencies | Outputs |
| ----- | --------- | ------------- | ------- |
| 1.1 Ingest Agent | YES (with 1.2) | Sync A | Ingest adapter, normalized payload per email-schema |
| 1.2 Classifier Agent | YES | Sync A | Classifier endpoint/extension, intent + confidence per intent-taxonomy |

**Sync B:** Classifier and extractor contracts and confidence thresholds agreed (and implemented where “contract” implies API shape). No Phase 2 until Sync B. Status: [docs/contracts/SYNC_B_VALIDATION.md](contracts/SYNC_B_VALIDATION.md).

**Phase 1 implemented:** Ingest and Classifier agents live in **ai-microservice** (`POST /api/email-triage/ingest`, `POST /api/email-triage/classify`). agentic-email-processing-system exposes `POST /api/ingest` and `POST /api/classify` and proxies to ai-microservice; events emitted to `LOGGING_SERVICE_URL`. Phase 1 verification: [docs/PHASE1_VERIFICATION.md](PHASE1_VERIFICATION.md). Extractor contract: [docs/contracts/extractor-contract.md](contracts/extractor-contract.md). **Phase 1 executed** (2026-03-06): app run and endpoints verified; re-run 2026-03-06 (health OK; E2E requires ai-microservice with `/api/email-triage` public per shared/auth.py). See PHASE1_VERIFICATION.md § Phase 1 execution.

---

## 5. Phase 2 — Extract + Decide (After Sync B)

| Group | Parallel? | Dependencies | Outputs |
| ----- | --------- | ------------- | ------- |
| 2.1 Extractor Agent | YES (with 2.2) | Sync B | Extractor endpoint, entities/structured data per contract |
| 2.2 Action/Decider Agent | YES | Sync B | Action selector endpoint, action per action-set and routing-rules |

**Phase 2 implemented:** Extractor and Action/Decider in ai-microservice (`POST /api/email-triage/extract`, `POST /api/email-triage/decide`). agentic-email-processing-system exposes `POST /api/extract` and `POST /api/decide`; events emitted per event-schema.

**Sync C:** Action/escalation rules and logging schema validated (implementation matches contracts). Status: [docs/contracts/SYNC_C_VALIDATION.md](contracts/SYNC_C_VALIDATION.md). No Phase 3 until Sync C.

---

## 6. Phase 3 — Act + Escalate (After Sync C)

| Group | Parallel? | Dependencies | Outputs |
| ----- | --------- | ------------- | ------- |
| 3.1 Act + Escalate | NO (sync) | Sync C | End-to-end flow: act (auto-respond/route) or escalate; observability checklist |

**Phase 3 implemented:** End-to-end **POST /api/triage** (ingest → classify → extract → decide → act); final event with agent=act and decision=action. Observability: [docs/OBSERVABILITY_CHECKLIST.md](OBSERVABILITY_CHECKLIST.md).

**Sync D:** End-to-end flow and observability checklist approved. Status: [docs/contracts/SYNC_D_VALIDATION.md](contracts/SYNC_D_VALIDATION.md). Cutover checklist complete.

---

## 7. Validation Checklist for Cutover

- [x] Email schema and intent taxonomy frozen (Sync A).
- [x] All agent decisions and escalations logged; event schema in use; `LOGGING_SERVICE_URL` used.
- [x] No hardcoded URLs/keys; config via `.env`; keys in `.env.example` (no secret values).
- [x] Confidence thresholds and ambiguity handling (unknown, multi-intent, escalate-by-default) documented and applied.
- [x] Action set and escalation contract implemented; escalation reasons auditable.
- [x] At least one end-to-end path: ingest → classify → extract → decide → act or escalate (POST /api/triage).
- [x] Five approaches for the target telecom enterprise documented and up to date in `docs/FIVE_APPROACHES.md`.
- [x] Validator sign-off on Sync A (and Sync B–D when applicable) recorded (Sync A, B, C, D passed).

---

## 8. Document References

- Master prompt: [docs/agents/master-prompt.md](agents/master-prompt.md)
- Five approaches (telecom enterprise): [docs/FIVE_APPROACHES.md](FIVE_APPROACHES.md)
- Integration: [docs/INTEGRATION.md](INTEGRATION.md)
- CREATE_SERVICE: [CREATE_SERVICE.md](../../CREATE_SERVICE.md) (repo root)
- AI microservice: [ai-microservice/README.md](../../ai-microservice/README.md)
- Contracts (after Phase 0): `docs/contracts/` (email-schema, event-schema, intent-taxonomy, action-set, routing-rules, escalation-contract, SYNC_A/B/C/D_VALIDATION)
- Observability: [docs/OBSERVABILITY_CHECKLIST.md](OBSERVABILITY_CHECKLIST.md)

---

**Lead Orchestrator:** Use this index to spawn Phase 0 agents (prompts in §3). Enforce Sync A before any implementation. Update this index when adding Phase 1–3 detailed task prompts or when design decisions affect the five approaches.
