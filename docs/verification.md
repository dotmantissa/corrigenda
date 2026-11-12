# Verification evidence

This report distinguishes deterministic tests, real validator execution and public deployment status. Studio lifecycle finality alone does not prove execution success. Receipts are checked against the deciding leader's execution result and independent agreement votes.

## Verified locally

On 11 November 2026, `npm test` passed 35 server unit tests and 53 deterministic contract and captured validator tests. `npm run lint` passed ESLint, TypeScript and pinned GenVM checks for all five deployable contracts. The server tests cover session rejection, account ownership, signed journal recovery, lifecycle interpretation, conflict handling, bounded assessment retries, exact source retrieval, empty pending certificates, index cursors and bounded dispatch scheduling. Contract tests cover authority, complete evidence bindings, stale ancestors, independent semantic vectors, finalized delivery, generation acknowledgement and unresolved successor recovery. Clean Node 22.23.4 installation and production builds passed.

On 12 November, the final offline rebuild changes passed ESLint, TypeScript and formatting checks. Restoring the populated correction bracket then passed ESLint and a clean Node 22.23.4 production build. That interface change preserves source text, layout widths and transaction behavior; contract sources remain unchanged.

## Public deployments

Current Studio addresses and runner identity are in `deployments/studionet.json`. Each core deployment and binding has a saved finalized receipt in `verification/receipts`. Consumer contracts have distinct owner accounts, separate from the registry/court operator. The production workspace is [corrigenda.vercel.app](https://corrigenda.vercel.app).

An actual semantic probe on the pinned hosted runner independently evaluated the complete public PEP 724 records, producing contradiction, old support TRUE, new support FALSE and material quarantine. Its receipt and validator results are retained. This diagnostic probe is distinct from the complete application integration.

## Verified signed integration

The current signed 21-rank PEP 724 integration completed successfully on the successor contracts. Positive authorization passed, then opening the withdrawal denied stale authorization before notice delivery. The first current assessment finalized with three agree votes: RETRACTION, old support TRUE, new support FALSE, material quarantine. Evidence is in `verification/public-assessment.json` and `verification/public-integration.json`.

The worker was actually terminated by SIGKILL after broadcast. Recovery reconciled the same persisted signed transaction hash to FINALIZED, then both public dispatch pages succeeded. `verification/worker-crash.json` retains the termination and recovered receipt. The completed index proof in `verification/index-rebuild.json` matches every current history event and all 21 delivered public notices to the dispatcher.

On 12 November, the final index rebuild resumed from dispatcher cursor 40 after an hourly RPC quota rejection and a transient Neon connection reset. It retained the existing projections and completed registry 9/9, court 8/8 and dispatcher 56/56. The offline runner now spaces records by 15 seconds and retries quota and transport interruptions at most three times before stopping with its durable cursor intact.

Controlled restoration completed for both separately owned consumers. Both positive baselines passed, both stale actions were refused after withdrawal, and independent withdrawal/replacement assessments each reached multi-validator agreement. Owner acceptance restored both actions only after the authenticated consumer acknowledgement finalized. An early action was correctly rejected with “Remediation acknowledgement not finalized”; that receipt is preserved as `verification/receipts/restoration-before-final-ack-listing.json`. The resumable runner now waits for that callback. `verification/restoration.json` records the completed path.

Signed network security also completed. Unauthorized policy and action writes, forged certificates, forged notices and forged delivery confirmations were refused. Both replayed consumer callbacks finalized successfully without changing restored authorization. Opening a newer correction refused an old acknowledgement and a future action before new notice delivery. Expired configuration was refused; the newer correction then reached TIMEOUT with an unresolved finalized dispatcher certificate. `verification/security-network.json` retains those results. Studio reported a transaction clock 3600 seconds ahead of the local machine; the runner derives deadlines and expiry from that network clock. Two rejected local-clock opening receipts are preserved. The final journal audit in `verification/journal-final.json` records five finalized operations and zero active operations.

Real email authentication and both user-owned adapter deployments completed through the production authenticated API, durable operation journal and worker at the archived deployment. `verification/email-account.json` contains public addresses and receipts only. Six live HTTP security cases passed before successor-network activation, including an authenticated attempt to act through a foreign consumer; results are in `verification/http-security.json`. Both successor email adapters subsequently finalized through the preserved signing journal. `verification/email-migration.json` records those current addresses and hashes without claiming a fresh login.

The public PEP records are authentic historical source revisions. The operator is explicitly a public record observer; this is not an endorsement or adoption by Python. Restoration records served at `/evidence/integration/` are labeled controlled verification fixtures, not customer attestations.

## Historical failures

`verification/archive` preserves earlier deployments and receipts. Their addresses use older contract versions. An initial header layout was rejected by the hosted runtime. A later real assessment failed with malformed model decision labels and disagree votes; it produced no positive certificate, and stale authorization remained denied. The tightened output vocabulary passed the subsequent real diagnostic probe. The latest core was redeployed after strengthening the finality guard. Three later witness-copy assessments also failed closed at archived addresses and produced no certificate. The successor contract attaches already-locked binding fields deterministically while preserving independently derived semantic decisions. Archived results do not prove behavior at the current addresses.

## Observed resource limits

Enforced packet, graph and dispatch ceilings are documented in `docs/limits.md`. The observed Studio RPC quotas are 30 requests per minute and 500 per hour; signing, integration and index reconstruction run sequentially. Observed resource measurements are retained in `verification/resource-profile.json`, separately from those limits. Studio reports six participant entries for the three current assessments. The public leader reports 8814 input and 67 output tokens; the withdrawal and replacement leaders report 1304/41 and 1559/68. Reported gas used is zero on gasless Studio. Creation-to-last-vote intervals are 55, 10 and 11 seconds respectively. Raw processing-time and execution-statistics fields are preserved in Studio’s units; these observations are not production ceilings or CPU/memory estimates.

## Production interface

The current production packet contains ten settled desktop/mobile captures covering both inbox themes, the timeline, dependency map and unauthenticated Applications state. `verification/final-browser.json` records production source `9bad31b`, finalized withdrawal, 21 quarantined public dependencies, 21 delivered notices, complete delivery panels, the restored correction bracket and exact authentic source text. Both widths pass page-error and document-overflow checks. Public deployment identity is retained in `deployments/vercel.json`.

The earlier independent reviewer cleared five UI fixes using fourteen valid desktop/tablet/mobile captures. The final reviewer scored the restored correction bracket resolved, with no regressions attributable to that fix; the scoped verdict and prior full review are retained in `.impeccable/review/final-finish-review.md`. Current Applications captures establish the email access boundary; completed authenticated remediation is established separately by signed network evidence.

The dependency audit records 28 findings, including 13 high-severity transitive findings, predominantly from Privy wallet dependencies using Zod 3. Direct server Zod 4.6.7 is patched. An incompatible Zod 3-to-4 override was not applied. Details are retained in `verification/dependency-audit.json`.
