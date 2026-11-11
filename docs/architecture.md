# Architecture and trust

Corrigenda separates evidence storage, semantic assessment, deterministic propagation and application enforcement.

RevisionRegistry records immutable manifests and signed issuer configuration. ImpactCourt locks a correction envelope and reads authentic records independently on each validator. DependencyDispatcher stores ranked nodes, flattened bounded ancestor references, reverse indexes and a generation aware outbox. ListingConsumer and DeploymentConsumer enforce their own agreed remediation policy.

Public records bind authority, channel, URL, bytes, scope and span locators. A configured principal signs each registration. This attests the principal's configuration and commitment, not universal truth. Validators verify bytes and spans and evaluate contrary statements and policy exceptions. Unavailable evidence remains unresolved. No private documents enter contract state.

Cross contract consequence messages use `emit(on="finalized")`. Only the configured source contract can receive or forward them. A synchronous view is used to conservatively deny stale evidence, never to authenticate a positive semantic certificate. Consumer activation and replacement acceptance require an authenticated finalized message. All descendants retain immutable ancestor references, so dispatch lag cannot make stale evidence usable.

The web server verifies Privy email sessions, checks ownership and signs transactions using a user controlled embedded wallet. The worker can broadcast, reconcile and index operations. It cannot decide impact or sign as an unrelated consumer. PostgreSQL is a rebuildable index and operation journal; the network is decisive.

Deadlines use the runtime supplied transaction datetime, not a server clock inside contracts. Schemas are immutable within a deployment. Compatible future storage additions belong at the end; incompatible changes require new deployment and explicit consumer rebinding.
