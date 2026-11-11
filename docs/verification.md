# Verification evidence

This report distinguishes deterministic tests, real validator execution and public deployment status. Studio lifecycle finality alone does not prove execution success. Receipts are checked against the deciding leader's execution result and independent agreement votes.

## Verified locally

On 11 November 2026, `npm test` passed 35 server unit tests and 53 deterministic contract and captured validator tests. `npm run lint` passed ESLint, TypeScript and pinned GenVM checks for all five deployable contracts. The server tests cover session rejection, account ownership, signed journal recovery, lifecycle interpretation, conflict handling, bounded assessment retries, exact source retrieval, empty pending certificates, index cursors and bounded dispatch scheduling. Contract tests cover authority, complete evidence bindings, stale ancestors, independent semantic vectors, finalized delivery, generation acknowledgement and unresolved successor recovery. Clean Node 22.23.4 installation and production builds passed.

## Public deployments

Current Studio addresses and runner identity are in `deployments/studionet.json`. Each core deployment and binding has a saved finalized receipt in `verification/receipts`. Consumer contracts have distinct owner accounts, separate from the registry/court operator. The production workspace is [corrigenda.vercel.app](https://corrigenda.vercel.app).

An actual semantic probe on the pinned hosted runner independently evaluated the complete public PEP 724 records, producing contradiction, old support TRUE, new support FALSE and material quarantine. Its receipt and validator results are retained. This diagnostic probe is distinct from the complete application integration.

## Integration progress

The real signed 21-rank PEP 724 application integration is in progress. All 21 historical dependencies and a positive listing finalized successfully, and opening the correction denied stale authorization before notification. Three actual assessment submissions then failed closed on exact model-copied witness/rule fields; no certificate was produced. A successor repair attaches those already-locked fields deterministically while preserving independently derived semantic decisions. Its hosted probe and fresh deployment are tracked separately from the historical run. A completed integration report, worker crash recovery proof, controlled restoration evidence and signed security scenarios must all be present before this report can claim those paths passed.

Real email authentication and both user-owned adapter deployments completed through the production authenticated API, durable operation journal and worker at the archived deployment. `verification/email-account.json` contains public addresses and receipts only. Six live HTTP security cases passed before successor-network activation, including an authenticated attempt to act through a foreign consumer; results are in `verification/http-security.json`. Both successor email adapters subsequently finalized through the preserved signing journal. `verification/email-migration.json` records those current addresses and hashes without claiming a fresh login.

The public PEP records are authentic historical source revisions. The operator is explicitly a public record observer; this is not an endorsement or adoption by Python. Restoration records served at `/evidence/integration/` are labeled controlled verification fixtures, not customer attestations.

## Historical failures

`verification/archive` preserves earlier deployments and receipts. Their addresses use older contract versions. An initial header layout was rejected by the hosted runtime. A later real assessment failed with malformed model decision labels and disagree votes; it produced no positive certificate, and stale authorization remained denied. The tightened output vocabulary passed the subsequent real diagnostic probe. The latest core was redeployed after strengthening the finality guard. Archived results do not prove behavior at the current addresses.

## Limits and remaining validation

Enforced packet, graph and dispatch ceilings are documented in `docs/limits.md`. The observed Studio RPC quota is 30 requests per minute; signing, integration and index reconstruction run sequentially. Observed resource measurements will be captured separately from those limits. Settled desktop, tablet and mobile captures in both themes passed overflow/error checks. The independent reviewer cleared all five UI fixes after inspecting fourteen valid captures, including authentic populated comparisons in both themes. That verdict covers the scored UI fixes; finalized delivery and remediation still require live network evidence. Remaining checks include full current-network integration, index reconstruction, final credential scan and publication.

The dependency audit records 28 findings, including 13 high-severity transitive findings, predominantly from Privy wallet dependencies using Zod 3. Direct server Zod 4.6.7 is patched. An incompatible Zod 3-to-4 override was not applied. Details are retained in `verification/dependency-audit.json`.
