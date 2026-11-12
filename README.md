# Corrigenda

Facts change. Their consequences should catch up.

Corrigenda connects a published correction to the application decisions that relied on it. Owners register exact source revisions and the propositions behind their decisions. GenLayer validators compare the records independently. Material changes pause future authorization until the application accepts supporting replacement evidence.

[Open the workspace](https://corrigenda.vercel.app)

## What you can do

Read the correction inbox, compare committed source records, follow dependencies, inspect the delivery journal, and work through remediation. Email is the only sign in method. The server handles signing and keeps each request's progress visible.

The two consumer contracts cover provider listings and deployment approvals. Both check their registered source ancestors at action time. A correction can therefore stop a stale decision before its notice arrives. Delivery runs in pages of twenty, with a durable journal for process restarts and duplicate callbacks.

## Run it locally

Use Node 22 and Python 3.12 or newer. Python needs pip. The exact JavaScript dependency tree is in `package-lock.json`; the Python environment is in `requirements.lock`.

```sh
nvm use
npm run setup
```

On the first run, setup creates a private `.env` from the example. Add your Privy, Neon and Studio credentials there. Use a fresh 32 byte hexadecimal custody encryption key and a private scheduler secret. Keep them on the server. Then run:

```sh
npm run db:migrate
npm run dev
npm run worker
```

The web app and worker run in separate terminals. Set `APP_ORIGIN` to the address your browser uses. Studio transactions are sponsored, so visitors do not need to connect a wallet.

## Check the work

```sh
npm run lint
npm test
npm run build
npm run test:network
npm run test:restoration
npm run test:security
npm run index:rebuild
```

The first three commands run without network signing credentials. The network examples use real signed Studio transactions and retain receipts under `verification`. The public source case uses the genuine withdrawal of Python PEP 724. The restoration case uses explicitly labeled controlled public records. Those records are verification fixtures, not customer adoption or an endorsement by Python.

The network example creates separate consumer owner keys in an ignored local file. Keep those keys private. Its dispatcher recovery test kills the worker after broadcast, then reconciles the same signed operation from the journal.

Run network signing and index reconstruction sequentially: the observed Studio quotas are 30 RPC requests per minute and 500 per hour. The offline rebuild spaces records by 15 seconds and retries quota and transient transport failures within a bounded window. Resume an interrupted rebuild with `npm run index:rebuild -- --resume`; it keeps the durable history cursors and replays an incomplete page.

When deploying changed contracts, archive the old manifest, source and receipts before resetting the current manifest. Run `npm run deploy:contracts`, then `npm run deploy:consumers`, and deploy the new manifest with the server. Reconcile all pending signed operations before `npm run activate:network`, which clears only historical adapter caches and queues replacement adapters through the existing journal while retaining identity keys and operation history. Run `npm run migrate:adapters` to reconcile those queued replacements and capture their public receipts. Historical adapters remain bound to their historical dispatcher.

## Repository guide

| Path                  | Purpose                                                          |
| :-------------------- | :--------------------------------------------------------------- |
| `src/app`             | Next.js routes and server endpoints                              |
| `src/components`      | Workspace, forms, identity and brand                             |
| `src/lib/server`      | Authentication, custody, signing, dispatch and indexing          |
| `src/lib/shared`      | Canonical commitments and typed requests                         |
| `contracts/src`       | Maintained Intelligent Contract source                           |
| `contracts`           | Generated standalone deployable contracts                        |
| `database/migrations` | Versioned PostgreSQL schema                                      |
| `scripts`             | Setup, deployment, recovery and integration runners              |
| `tests`               | Contract state tests, captured validator probes and server tests |
| `deployments`         | Public network addresses and deployment identity                 |
| `verification`        | Receipts, public records and verification evidence               |
| `docs`                | API, trust boundaries and resource limits                        |

## A few boundaries worth knowing

Source text cannot instruct validators. Authority comes from an explicitly configured principal and disclosed evidence, rather than from a convincing URL. Unavailable records stay unresolved. The database is a rebuildable projection; the contracts decide authorization.

This release uses custodial accounts. The service operator can access their encrypted signing keys through the server encryption key. Email access makes the workflow simpler, but does not remove that trust relationship. Governance and the consumer integration owners use separate keys.

Finalized source contract messages carry consequence bearing certificates. A view can conservatively deny stale evidence; it cannot prove a positive certificate is final. Historical irreversible payouts are never automatically reversed.

The Vercel Hobby plan permits a daily cron. Signed requests and account polling also wake the worker. For continuous unattended propagation, run `npm run worker` on a persistent service or configure a more frequent authorized scheduler. Action time quarantine remains enforced during any dispatch delay.

Dependency registration and bounded assessment produce usage ledger entries. Public incident inspection is free. Pricing and payment collection require an explicit commercial configuration; this deployment does not charge an invented fee.

See [the API](docs/api.md), [the architecture](docs/architecture.md), and [verification evidence](docs/verification.md) for the exact permissions and tested boundaries.
