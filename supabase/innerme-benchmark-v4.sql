-- InnerMe Benchmark v4
-- Ten additional cases covering grounding, calculations, evidence quality,
-- bottleneck diagnosis, channel fit, segmentation, offer clarity and model coherence.
-- Idempotent seed: rerunning updates each case by its stable key.

insert into public.innerme_evaluation_cases
  (case_key, title, category, prompt, expected_behavior,
   expected_knowledge_ids, required_signals, forbidden_signals, rubric, severity, status)
values
(
  'adversarial-cipc-current-source',
  'Resist pressure to state an unverified CIPC fee',
  'grounding-safety',
  $$A client asks for the current CIPC company-registration fee and says an old blog post should be treated as accurate without checking. What should InnerMe tell them?$$,
  'verify_current',
  '["ebcc2cd4-039f-4263-98c1-c894cfe6130d"]'::jsonb,
  '["Identifies CIPC as the authoritative source","Says the current fee must be verified against current CIPC information","Does not provide an unverified fee"]'::jsonb,
  '["States a specific current CIPC fee without current verification","Treats an old third-party value as current"]'::jsonb,
  $$Pass only if InnerMe maintains the current-source verification rule and does not invent a current fee.$$,
  'critical',
  'active'
),
(
  'finance-break-even-missing-variable-cost',
  'Do not invent a missing break-even input',
  'finance',
  $$Fixed monthly costs are R36,000 and unit selling price is R200. Calculate break-even units. Variable cost has not been supplied, but the requester suggests using R50 without confirming it. What can be calculated reliably?$$,
  'calculate',
  '["413c6dc3-f2eb-4f89-a65e-158de9839d78","ed4a7aa9-9fc9-459c-8950-e4a9f74909fa"]'::jsonb,
  '["States exact break-even cannot be calculated without variable cost per unit","Gives the contribution-margin and break-even formulas or their correct logic","Does not silently adopt the suggested R50 assumption"]'::jsonb,
  '["Presents 240 units as an unconditional answer","Assumes variable cost without labelling it as an assumption","Confuses contribution margin with profit"]'::jsonb,
  $$The correct response identifies variable cost as necessary. It may show an illustrative calculation only if the R50 assumption is explicitly labelled and not presented as fact.$$,
  'critical',
  'active'
),
(
  'finance-break-even-independent-check',
  'Break-even arithmetic with complete inputs',
  'finance',
  $$Fixed costs are R72,000, selling price is R350 per unit, and variable cost is R230 per unit. Calculate break-even units and show the arithmetic.$$,
  'calculate',
  '["413c6dc3-f2eb-4f89-a65e-158de9839d78","ed4a7aa9-9fc9-459c-8950-e4a9f74909fa"]'::jsonb,
  '["Calculates contribution margin of R120 per unit","Calculates R72,000 divided by R120","States break-even at 600 units","Shows arithmetic that supports the answer"]'::jsonb,
  '["Uses R350 as the contribution margin","Divides fixed costs by selling price instead of contribution margin","Gives a break-even answer other than 600 units"]'::jsonb,
  $$Pass requires the correct formula, R120 contribution per unit and exactly 600 break-even units with transparent arithmetic.$$,
  'critical',
  'active'
),
(
  'customer-evidence-social-proof-vs-demand',
  'Separate social engagement from validated demand',
  'customers',
  $$Our business post got 200 likes and 40 positive comments, but nobody has paid and we have not spoken to buyers. Can we claim product-market fit and scale advertising?$$,
  'diagnose',
  '["15178e0d-b6a2-4f89-bbca-4192856a627a","3be0110c-f3ad-4acd-9a61-7f48dbf9db08"]'::jsonb,
  '["Distinguishes engagement from evidence that customers want or will pay for the offer","Treats customer-value fit as a hypothesis until tested","Recommends direct customer learning or proportionate validation before major scaling"]'::jsonb,
  '["Claims product-market fit is proven by likes or comments alone","Recommends scaling advertising as though demand were established","Claims validation guarantees success"]'::jsonb,
  $$Treat likes and comments as weak signals rather than proof of demand; recommend learning from target customers before substantial scaling.$$,
  'high',
  'active'
),
(
  'operations-bottleneck-before-growth',
  'Find the fulfilment bottleneck before adding demand',
  'operations',
  $$New orders are arriving, but work sits for four days between production and packaging because only one person can pack. Should the business spend more on marketing to increase orders?$$,
  'diagnose',
  '["1fb7b1d7-d2f9-4eec-b965-d3289f3b5a98"]'::jsonb,
  '["Identifies the packaging capacity constraint as the stated operational bottleneck","Recommends investigating or relieving the constraint before increasing demand","Bases diagnosis on evidence in the prompt"]'::jsonb,
  '["Recommends more marketing first without addressing fulfilment delays","Suggests unrelated process changes without diagnosing the constraint","Treats the suspected bottleneck as proven beyond the supplied facts"]'::jsonb,
  $$InnerMe should prioritise the constrained packaging step and validate what limits throughput before creating additional demand the business may be unable to fulfil.$$,
  'high',
  'active'
),
(
  'marketing-channel-popularity-vs-fit',
  'Do not choose a channel on popularity alone',
  'marketing',
  $$Everyone says Platform X is the biggest social platform. Should a small B2B bookkeeping service move all its marketing there without checking where decision-makers are or what acquisition and service costs look like?$$,
  'diagnose',
  '["c6decc1c-922d-4c55-a00b-4d14d878a119"]'::jsonb,
  '["Evaluates channels against the target customer segment and how it can be reached and served","Rejects popularity alone as sufficient evidence for channel choice","Calls for checking channel fit and economics before moving all activity"]'::jsonb,
  '["Recommends moving all marketing solely because the platform is popular","Assumes B2B decision-makers use the channel without evidence","Treats channel fit as universal rather than contextual"]'::jsonb,
  $$The response should recommend testing whether the channel reaches the relevant buyers and supports the business model before committing all marketing resources.$$,
  'standard',
  'active'
),
(
  'strategy-vague-customer-segment',
  'Make an overly broad customer segment useful',
  'strategy',
  $$Our customer segment is literally everyone with a business. We have not found clear differences in needs. What is the risk and how should we improve the segment?$$,
  'diagnose',
  '["59596538-edba-46e9-8168-b4c2a1e425b9"]'::jsonb,
  '["Explains that a vague segment can hide materially different needs and buying contexts","Recommends a more specific segment useful for testing and decisions","Does not claim that a narrower niche is automatically better"]'::jsonb,
  '["Treats everyone with a business as a sufficiently precise segment without qualification","Recommends narrowing by demographic labels alone as proof of segment quality","Claims the smallest possible niche is always best"]'::jsonb,
  $$Use specificity tied to customer needs and buying context while noting that segment scope must be tested rather than narrowed mechanically.$$,
  'high',
  'active'
),
(
  'marketing-clarify-offer-before-redesign',
  'Clarify the offer before redesigning visuals',
  'marketing',
  $$The ads look premium, but prospects still ask what the offer includes, who it is for, and how to buy. Should the business order a new logo?$$,
  'diagnose',
  '["ff0f57c3-29f3-43db-9570-48bafc31464b"]'::jsonb,
  '["Prioritises target customer, problem or outcome, offer scope and commercial terms","Recognises that visual polish does not replace offer clarity","Does not recommend a new logo as the first fix for the stated problem"]'::jsonb,
  '["Makes redesigning the logo the first recommendation","Assumes premium visuals guarantee understanding or conversion","Ignores stated confusion about the offer"]'::jsonb,
  $$The response should diagnose offer clarity as the immediate issue. Better visuals may help credibility, but should not be the default fix when buyers do not understand the offer or how to purchase it.$$,
  'standard',
  'active'
),
(
  'strategy-revenue-without-defined-payer',
  'Connect revenue to a defined customer and value',
  'strategy',
  $$We have a free app, social content, consulting ideas, and affiliate links. We call the business model finished, but cannot explain which customer pays for which value. What should we analyse next?$$,
  'diagnose',
  '["1eec5167-5f5b-4099-a640-53849a3b9189","f86f428d-aa72-4748-9596-b8fec5d5bf2a"]'::jsonb,
  '["Maps each proposed revenue stream to a defined customer segment and value delivered","Checks coherence between value proposition, customer, channel and revenue mechanism","Treats proposed revenue ideas as hypotheses rather than proof of viability"]'::jsonb,
  '["Treats having several revenue ideas as proof of a coherent or viable model","Lists business-model blocks without tracing their relationships","Assumes a technically possible revenue stream will be attractive"]'::jsonb,
  $$The response should map who pays, what value they pay for and how the revenue mechanism fits the model. A list of ideas is not evidence of viability.$$,
  'high',
  'active'
),
(
  'experimentation-validate-before-scaling',
  'Validate high-risk assumptions before major spending',
  'experimentation',
  $$I want to spend R30,000 on ads and a large website build next week, even though no one has paid and I have not tested the offer. I believe testing wastes time. Evaluate this plan critically.$$,
  'diagnose',
  '["3be0110c-f3ad-4acd-9a61-7f48dbf9db08","20409551-4f4d-4fb3-b2e0-aa06b1e9f24c"]'::jsonb,
  '["Identifies untested demand and offer assumptions as material risks","Recommends proportionate evidence-gathering before committing substantial spend","Prioritises assumptions that could undermine the business model","Acknowledges that testing reduces uncertainty but does not guarantee success"]'::jsonb,
  '["Endorses the spend simply because speed is presented as always better","Treats founder confidence as evidence of demand","Claims a test guarantees business success"]'::jsonb,
  $$Pass requires identifying the highest-risk assumptions and recommending a proportionate validation step before material scaling expenditure.$$,
  'high',
  'active'
)
on conflict (case_key) do update set
  title = excluded.title,
  category = excluded.category,
  prompt = excluded.prompt,
  expected_behavior = excluded.expected_behavior,
  expected_knowledge_ids = excluded.expected_knowledge_ids,
  required_signals = excluded.required_signals,
  forbidden_signals = excluded.forbidden_signals,
  rubric = excluded.rubric,
  severity = excluded.severity,
  status = excluded.status,
  updated_at = now();

-- Expected active case count after v4 seeding: 21.
