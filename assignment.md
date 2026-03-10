Subject: Agentic Email Processing System – Design, Implementation, and Rationale

As requested, here is an overview of how I approached and implemented the Agentic Email Processing System for the technical assignment, and how it addresses the points you care about: autonomous workflow design, LLM/agent orchestration, reliability/observability, handling ambiguity, and business-oriented automation.

### Business Problem & Goals

Your scenario is that large volumes of inbound business emails (support, sales, contracts, technical issues, billing, and spam) are currently triaged manually, which is slow, inconsistent, and error-prone.

The goal of my solution (`agentic-email-processing-system`) is to automatically:

1. Understand each incoming email
2. Classify its intent
3. Extract the relevant business information
4. Trigger appropriate actions
5. Escalate to humans when necessary

### High-Level System Design

I implemented the system in **two modes**:

- **Fast, non‑AI (rule-based) mode**
  - Optimized for speed, determinism, and low operational risk
  - Uses pattern/rule-based logic (subject, sender, keywords, routing rules) to:
    - Classify email intent (support / sales / contract / technical / billing / spam)
    - Extract key fields where possible (e.g., account IDs, order numbers)
    - Route to the correct queue or trigger simple automated responses

- **AI-assisted mode (agentic)**
  - Uses LLMs only for **two stages**:
    1. **Classifier Agent** – understands the email, determines primary intent (and optionally secondary intents), and assigns a confidence score.
    2. **Decider Agent** – given the parsed email, the classifier output, and business rules, decides:
       - Which workflow/action to run (e.g., create support ticket, forward to sales, reply with a template, schedule a follow-up, etc.)
       - Whether to escalate to a human and with what summary/context.

All other pieces (parsing, routing, logging, and integrations) are implemented as standard services around these agents so that the system is debuggable and production-friendly.

### Autonomous Workflow Design

The processing pipeline is structured as an **autonomous workflow**:

1. **Ingestion**
   - Receives raw emails from an inbox / webhook / queue.
   - Normalizes them into a structured internal representation (sender, recipients, subject, body, attachments metadata, etc.).

2. **Intent Classification (Rule-based or AI Classifier)**
   - **Rule Mode:** deterministic rules (e.g., regex, keyword + sender domain + routing rules) for known patterns.
   - **AI Mode:** LLM-based classifier agent that:
     - Assigns one of the main categories: support, sales, contract, technical, billing, spam/irrelevant.
     - Optionally tags secondary intents and urgency.

3. **Information Extraction**
   - Extracts business-relevant fields:
     - IDs (customer/account/ticket/order), product names, contract numbers, error codes, urgency signals, etc.
   - In rule mode this is done via patterns and heuristics.
   - In AI mode the classifier and decider work together: the classifier focuses on intent; the decider is given both the raw email and extracted fields to decide if they are sufficient or if human review is needed.

4. **Decision & Action (AI Decider + Business Rules)**
   - **Decider Agent** combines:
     - Email content + extracted fields
     - Classifier output + confidence
     - Static business rules (SLA tiers, customer segment, allowed automations)
   - It then chooses actions, for example:
     - Create/update a ticket with structured fields
     - Route to sales with a CRM-ready summary
     - Reply with a predefined template (e.g., “we need more details”)
     - Tag as spam and archive
     - Escalate to a human operator with a concise summary and suggestion

5. **Escalation Logic**
   - Escalation is triggered when:
     - Confidence is below a threshold
     - Important fields are missing or contradictory
     - The email appears unusually risky (e.g., legal/contract ambiguity)
   - The human sees a structured summary, the raw email, and the proposed decision, which reduces review time.

### LLM/Agent Orchestration

The system uses **agents only where they add the most value**:

- **Classifier Agent**: semantic understanding, multi-label classification, and prioritization.
- **Decider Agent**: combines semantic understanding with rules to choose the safest/most effective workflow.

Everything else is simple, testable logic (parsing, queues, logging, configuration, integrations).

The agents are orchestrated through a clear, stepwise pipeline so we can:

- Fall back from AI mode to rule-based mode when needed.
- Compare performance between both modes.

### Model Strategy (Random Models for Evaluation)

For evaluation and experimentation, I deliberately **use different AI models randomly** (within a controlled set) in the AI mode:

- Each AI-run can be backed by a different model, which:
  - Produces slightly different results.
  - Allows side-by-side comparison across models and against the purely rule-based pipeline.

This is by design for **testing and benchmarking**:

- We can log the same email through different models and see:
  - Which model classifies more accurately.
  - Which decider produces fewer escalations without increasing error rate.
- Once we have enough data, we can **fix the best-performing configuration** for production.

### Reliability and Observability

Reliability is handled at multiple levels:

- **Dual-mode architecture**
  - Rule-based pipeline is available as a **safe, deterministic fallback**.
  - The AI-assisted mode can be gradually enabled and A/B tested without blocking operations.

- **Strict separation of concerns**
  - Parsing, classification, decision-making, action execution, and logging are modular.
  - Failures in one component (e.g., a specific model) don’t crash the whole system.

- **Extensive logging and tracing**
  - Every run captures:
    - Raw email metadata (not secrets), classification, extracted fields, decision taken, and escalation status.
    - Which mode (rule vs AI) was used and which AI model was selected.

This gives **full visibility into the dataflow**:

- You can trace exactly how an email was processed end-to-end.
- Makes it very easy to debug, tune rules, and refine prompts/models.

### Handling Ambiguity and Incomplete Data

- **Confidence-based behavior**
  - Both rule-based and AI classifier stages estimate confidence.
  - Below certain thresholds the decider:
    - Either escalates directly, or
    - Chooses a “safe minimal” action plus escalation (e.g., log it, open a draft ticket, notify a human).

- **Graceful degradation**
  - If the AI is unavailable, times out, or returns low-quality output, the system:
    - Falls back to the rule-based classifier/decider.
    - Still logs the event so we can analyze failure patterns.

- **Human-in-the-loop by design**
  - Escalation is not an afterthought: it is integrated as a first-class path in the workflow.
  - Ambiguous or high-risk messages always land in human queues with helpful summaries and recommendations.

### Business-Oriented Automation

The system is designed around **business outcomes**, not just technical classification:

- Aligns with business categories (support, sales, contracts, technical, billing, spam) to map directly into:
  - Ticket queues
  - CRM flows
  - Finance/billing processes
- Prioritization and escalation can be mapped to **SLAs**, customer tiers, and deal stages.
- Output is structured so it can be integrated into existing tools (ticketing, CRM, dashboards) with minimal glue code.

---

In summary, the `agentic-email-processing-system` implements the requested Agentic AI Email Triage System in **two complementary versions**:

- A **fast, deterministic rule-based version** (no AI).
- An **AI-assisted version** that uses LLMs only for the **Classifier** and **Decider** agents.

The AI mode uses **random model selection for testing** so we can compare different models and the rule-based approach and then standardize on the best-performing configuration in production. Throughout the pipeline, I’ve ensured **full logging and visibility** so that the entire dataflow is observable, debuggable, and suitable for production hardening.

I’m happy to walk through the architecture, logs, or code in more detail if that would be helpful.

Best regards,
Ing. Sergej Stasok
+420 774 287 541
