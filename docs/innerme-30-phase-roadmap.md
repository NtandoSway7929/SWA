# InnerMe 30-Phase Roadmap Knowledge Index

**Purpose:** Provide the internal InnerMe chat with a grounded, queryable map of the InnerMe architecture and its phase dependencies.

**Source of truth:** The current `main` branch implementation and its Supabase SQL artifacts. This index describes the code and documented design intent; it does not independently prove that every feature has been runtime-tested or is fully operational.

## How InnerMe must use this index

- Distinguish implemented code, intended behaviour, verified runtime behaviour, and planned work. A source file or SQL migration is evidence that an implementation artifact exists, not proof that every path works in production.
- Do not claim a phase is complete merely because a migration or code comment exists. Cite runtime tests, benchmark results, or persisted state when asked whether it works.
- Do not invent titles or responsibilities for phases whose source mapping is absent below.
- Preserve explicit safety boundaries: proposals and recommendations are not executed merely because they were generated; approvals, verification, permissions, and audit trails remain meaningful.
- InnerMe Lite is the public service-guidance assistant and is separate from this private internal InnerMe roadmap.

## Phase index

1. **Knowledge Foundation** — Structured knowledge records with source metadata, evidence level, jurisdiction, verification status, review windows and embedding state. Treat governance metadata as part of the knowledge, not optional decoration.
2. **Semantic Knowledge Retrieval** — Embedding-based similarity retrieval using the `gte-small` query embedding path and the `match_innerme_knowledge` RPC. Relevant evidence is retrieved for internal questions rather than treating the entire database as a fixed prompt.
3. **Learning Governance** — Feedback and learning must be reviewed and governed. A correction, feedback item, or model-generated candidate is not automatically authoritative knowledge.
4. **Knowledge Reasoning and Evidence Governance** — A family of knowledge-system extensions. Identified subphases include 4C verified knowledge reasoning, 4E knowledge intelligence/evidence attribution, 4F feedback loop and 4G controlled learning candidates. Exact titles for 4A, 4B and 4D are not established by the source mapping reviewed for this index.
5. **Knowledge Expansion Engine** — Identify and prioritise knowledge gaps and propose evidence-backed acquisition targets. **5B Controlled Knowledge Acquisition** adds source and acquisition-task governance; external information must not be silently promoted into live knowledge.
6. **Evaluation and Benchmarking** — Run fixed evaluation cases and persist case-level results and benchmark-run summaries. Provider/execution errors must remain distinguishable from answer-quality failures.
7. **Benchmark Regression Control** — Versioned benchmark controls and regression comparison protect previous evaluation baselines. Inconclusive provider failures are not valid evidence of a model-quality regression or a pass.
8. **Decision Intelligence** — Derive decision candidates from current workspace context and evidence. Recommendations remain candidates until an administrator reviews them.
9. **Execution Intelligence** — Convert approved decisions into governed execution plans. The phase is planning-oriented; creating a plan does not itself execute its steps.
10. **Controlled Action Automation** — Approved plans can produce action proposals. Only explicitly approved proposals may be executed, subject to the applicable policy and audit controls.
11. **Phase title/scope not verified** — The current source mapping does not identify a reliable Phase 11 title. Do not infer or invent one. Check the authoritative roadmap history or phase-specific implementation artifact before describing it.
12. **Phase title/scope not verified** — The current source mapping does not identify a reliable Phase 12 title. Do not infer or invent one. Check the authoritative roadmap history or phase-specific implementation artifact before describing it.
13. **Closed-Loop Learning** — Reviewed experiments and outcomes can create governed learning candidates. Live knowledge must not be changed automatically simply because an experiment or intervention occurred.
14. **Strategic Intelligence** — Produce cross-domain strategic reviews and governed recommendations. Recommendations remain candidates; promotion requires review.
15. **Phase title/scope not verified** — The current source mapping does not identify a reliable Phase 15 title. Do not infer or invent one. Check the authoritative roadmap history or phase-specific implementation artifact before describing it.
16. **Phase title/scope not verified** — The current source mapping does not identify a reliable Phase 16 title. Do not infer or invent one. Check the authoritative roadmap history or phase-specific implementation artifact before describing it.
17. **Proactive Escalation** — Deterministic exception monitoring can create notifications/escalations. It is not a blanket grant of permission for autonomous business mutation.
18. **Operational Incident Correlation** — Group related monitoring exceptions into auditable operational incidents so several signals can be examined together.
19. **Deterministic Incident Intelligence** — Calculate reproducible impact, urgency, dependency and priority signals for active operational incidents. Scores assist triage; they are not guarantees.
20. **Dependency and Leading-Factor Analysis** — Trace active incidents into workspace dependencies and leading factors to identify potentially influential relationships. A dependency signal alone does not prove causality.
21. **Causal Validation and Hypothesis Testing** — Score and review evidence-backed incident hypotheses. Treat hypotheses as hypotheses until supported; do not state causation merely because two signals correlate.
22. **Counterfactual and Intervention Analysis** — Advisory analysis of possible effects if a dependency or incident condition were changed. Counterfactual estimates are not observed outcomes.
23. **Intervention Selection and Sequencing** — Compare intervention options and recommend an evidence-backed order. Selection or sequencing does not execute an intervention.
24. **Controlled Intervention Execution and Verification** — Prepare only the explicitly selected recommendation; approval and execution are separate events, with subsequent verification.
25. **Outcome Verification and Intervention Learning** — Verify outcomes after execution. Successful execution is not automatically a successful business outcome; outcome evidence can feed governed learning.
26. **Adaptive Strategy and Optimisation** — Use historical measured intervention outcomes to influence future intervention ranking within bounded limits. Past outcomes guide prioritisation but do not guarantee future results.
27. **Multi-Agent Coordination** — Coordinate specialist agents through auditable assignments, plans and handoffs. Coordination must not grant permissions or silently execute actions.
28. **Predictive Business Intelligence** — Produce evidence-aware forecasts/projections for business variables such as revenue, cash and delivery. Forecasts are uncertain projections, not promises.
29. **Autonomous Governance and Trust Calibration** — Calibrate trust from auditable evidence and administrator-governed review. Trust scores do not grant permissions by themselves. The repository also contains Phase 29 private-RPC/governance hardening artifacts.
30. **Pre-Execution Action Safety Gate** — Require an audited policy safety check before controlled actions are approved or executed. The gate does not itself execute actions or grant permissions; it is a control in the action lifecycle.

## Cross-phase architecture

- **Knowledge path:** sources → evidence and verification governance → embeddings/indexing → semantic retrieval → evidence supplied to the answer → attribution/feedback → reviewed learning candidates.
- **Decision path:** workspace/evidence → decision candidate → administrator review → execution plan → action proposal → policy/safety checks → explicit approval → controlled execution → audit and outcome verification.
- **Incident path:** deterministic monitoring → proactive escalation → incident correlation and scoring → dependency/hypothesis analysis → counterfactuals → intervention selection → separately approved execution → outcome verification → bounded learning/optimisation.
- **Coordination and prediction:** forecasts and specialist-agent coordination support decisions; neither replaces evidence, approval, safety controls or outcome verification.

## Known caveats

- The source snapshot reviewed for this index does not establish definitive titles for phases 11, 12, 15 or 16, nor exact titles for 4A, 4B and 4D. Those gaps must remain explicit until primary roadmap artifacts are found.
- Phase labels in code may describe a subset of functionality or a follow-up hardening change. Do not assume phase numbering means strict linear dependency unless a migration, code path or roadmap explicitly establishes it.
- The active knowledge table and the system prompt may both supply context. If they conflict, prefer the newer authoritative repository/runtime evidence and disclose the conflict instead of silently choosing.
