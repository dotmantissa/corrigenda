'use client';
import { useState } from 'react';
import { ArrowLeft, FileText, ShieldCheck, Plus, Check, AlertCircle } from 'lucide-react';
import { type Snapshot, type Command, type Revision, type Proposition } from '@/lib/shared/schema';
import { canonical } from '@/lib/shared/canonical';
import { assessmentDeadline } from '@/lib/shared/assessment-window';
async function hash(value: unknown) {
  return Array.from(
    new Uint8Array(
      await crypto.subtle.digest('SHA-256', new TextEncoder().encode(canonical(value))),
    ),
  )
    .map((x) => x.toString(16).padStart(2, '0'))
    .join('');
}
const id = () => `request.${crypto.randomUUID().replaceAll('-', '')}`;
function Field({
  label,
  help,
  children,
}: {
  label: string;
  help?: string;
  children: React.ReactNode;
}) {
  return (
    <label className="form-field">
      <span>{label}</span>
      {children}
      {help && <small>{help}</small>}
    </label>
  );
}
export function RequestForm({
  type,
  snapshot,
  onClose,
  send,
  authenticated,
  signIn,
  getToken,
}: {
  type: 'source' | 'correction' | 'dependency';
  snapshot: Snapshot | null;
  onClose: () => void;
  send: (c: Command) => Promise<boolean>;
  authenticated: boolean;
  signIn: () => void;
  getToken: () => Promise<string | null>;
}) {
  const [busy, setBusy] = useState(false),
    [error, setError] = useState<string | null>(null),
    [preview, setPreview] = useState<{ text: string; manifest: Revision } | null>(null),
    [oldRevision, setOldRevision] = useState(''),
    [dependencyId, setDependencyId] = useState('');
  const revisions = snapshot?.revisions ?? [];
  const matching = (snapshot?.dependencies ?? []).filter((d) =>
    d.ancestors.some((a) => a.revision === oldRevision),
  );
  async function submit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!authenticated) {
      signIn();
      return;
    }
    if (!snapshot?.user) {
      setError('Your account is still being set up. Refresh in a moment.');
      return;
    }
    const f = new FormData(event.currentTarget);
    const value = (name: string) => String(f.get(name) ?? '').trim();
    setBusy(true);
    setError(null);
    try {
      if (type === 'source') {
        if (!preview) {
          const token = await getToken();
          const r = await fetch('/api/commit', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
            body: JSON.stringify({
              url: value('url'),
              revision_id: value('revision_id'),
              source_id: value('source_id'),
              scope: value('scope'),
              supersedes: value('supersedes'),
              span_id: value('span_id'),
              public_evidence_url: value('public_evidence_url'),
            }),
          });
          const result = await r.json();
          if (!r.ok) throw new Error(result.error);
          setPreview(result);
          return;
        }
        if (await send({ kind: 'register_revision', payload: preview.manifest })) onClose();
        return;
      }
      if (type === 'dependency') {
        const revision = revisions.find((r) => r.revision_id === value('revision'));
        if (!revision) throw new Error('Choose a registered revision.');
        const consumer =
          value('consumer_kind') === 'PROVIDER_LISTING'
            ? snapshot.user.listing_consumer
            : snapshot.user.deployment_consumer;
        if (!consumer) throw new Error('Set up your applications before registering a decision.');
        const p: Proposition = {
          id: value('proposition_id'),
          statement: value('statement'),
          materiality_question: value('question'),
          old_span: value('span'),
          new_span: value('span'),
          rule_ids: value('rule_ids')
            .split(',')
            .map((x) => x.trim())
            .filter(Boolean)
            .sort(),
        };
        const subject = value('subject');
        const payload = {
          request_id: id(),
          owner: snapshot.user.address,
          parties: [snapshot.user.address],
          policy_id: value('policy_id'),
          policy_revision: Number(value('policy_revision')),
          subject_id: subject,
          subject_digest: await hash({ subject }),
          source_manifest_digest: await hash([revision]),
          consumer,
          consequence_digest: await hash({
            kind: value('consumer_kind'),
            subject,
            policy: value('policy_id'),
          }),
          generation: 0,
          deadline: Math.floor(new Date(value('deadline')).getTime() / 1000),
          dependency_id: value('dependency_id'),
          rank: Number(value('rank')),
          parents: value('parents')
            .split(',')
            .map((x) => x.trim())
            .filter(Boolean),
          references: [
            {
              revision: revision.revision_id,
              proposition: p.id,
              span: value('span'),
              definition: p,
            },
          ],
          kind: value('consumer_kind') as 'PROVIDER_LISTING' | 'DEPLOYMENT_APPROVAL',
          unresolved_route: 'QUARANTINED' as const,
          remediation_route: 'ACCEPT_REPLACEMENT' as const,
        };
        if (await send({ kind: 'register_dependency', payload })) onClose();
        return;
      }
      const dependency = snapshot.dependencies.find(
        (d) => d.dependency_id === dependencyId,
      ) as Snapshot['dependencies'][number] & {
        references?: { definition: Proposition; revision: string }[];
        policy_id: string;
        policy_revision: number;
        subject_digest: string;
        source_manifest_digest: string;
      };
      const old = revisions.find((r) => r.revision_id === oldRevision),
        next = revisions.find((r) => r.revision_id === value('new_revision'));
      if (!old || !next || !dependency)
        throw new Error('Choose a revision pair and a registered consumer decision.');
      const propositions =
        dependency.references?.filter((r) => r.revision === oldRevision).map((r) => r.definition) ??
        [];
      if (!propositions.length)
        throw new Error(
          'The registered proposition definitions are not indexed yet. Try refreshing.',
        );
      const r = await fetch('/api/generation'),
        data = await r.json();
      if (!r.ok) throw new Error(data.error);
      const payload = {
        request_id: value('request_id') || id(),
        owner: snapshot.user.address,
        parties: [snapshot.user.address],
        policy_id: dependency.policy_id,
        policy_revision: dependency.policy_revision,
        subject_id: dependency.subject_id,
        subject_digest: dependency.subject_digest,
        source_manifest_digest: await hash([old, next]),
        consumer: dependency.consumer,
        consequence_digest: dependency.consequence_digest,
        generation: data.generation + 1,
        deadline: assessmentDeadline(data.network_time, Number(value('assessment_minutes'))),
        old_revision: oldRevision,
        new_revision: next.revision_id,
        propositions,
      };
      if (await send({ kind: 'open_correction', payload })) onClose();
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Check the request details and try again.');
    } finally {
      setBusy(false);
    }
  }
  return (
    <section className="request-form">
      <button className="text-button back-button" onClick={onClose}>
        <ArrowLeft size={16} />
        Back to workspace
      </button>
      <div className="form-heading">
        <span className="form-icon">
          {type === 'source' ? <FileText size={26} /> : <ShieldCheck size={26} />}
        </span>
        <div>
          <h2>
            {type === 'source'
              ? 'Register a source'
              : type === 'correction'
                ? 'Open a correction'
                : 'Register a decision'}
          </h2>
          <p>
            {type === 'source'
              ? 'An exact record now. A reliable reference later.'
              : type === 'correction'
                ? 'Lock the revisions. Let independent validators decide what matters.'
                : 'Make the evidence behind your decision explicit.'}
          </p>
        </div>
      </div>
      <form onSubmit={submit}>
        {type === 'source' && (
          <div className="form-grid">
            <Field
              label="Source name"
              help="Use a short identifier, with letters, numbers, dots or underscores."
            >
              <input
                required
                name="source_id"
                placeholder="provider_assurance"
                pattern="[A-Za-z0-9_.:]{1,96}"
                disabled={!!preview}
              />
            </Field>
            <Field label="Revision name">
              <input
                required
                name="revision_id"
                placeholder="assurance.2026.11"
                pattern="[A-Za-z0-9_.:]{1,96}"
                disabled={!!preview}
              />
            </Field>
            <div className="field-wide">
              <Field
                label="Public source URL"
                help="Use an immutable raw GitHub record, an RFC or a W3C public record."
              >
                <input
                  required
                  name="url"
                  type="url"
                  placeholder="https://raw.githubusercontent.com/…"
                  disabled={!!preview}
                />
              </Field>
            </div>
            <div className="field-wide">
              <Field
                label="Principal evidence URL"
                help="A public record disclosing who is registering this source. Its authority is explicitly configured, not inferred from its URL."
              >
                <input
                  required
                  name="public_evidence_url"
                  type="url"
                  placeholder="https://github.com/your_public_principal_record"
                  disabled={!!preview}
                />
              </Field>
            </div>
            <Field label="Replaces revision">
              <select name="supersedes" disabled={!!preview}>
                <option value="">First revision</option>
                {revisions.map((r) => (
                  <option key={r.revision_id} value={r.revision_id}>
                    {r.revision_id}
                  </option>
                ))}
              </select>
            </Field>
            <Field
              label="Controlling span name"
              help="This first registration commits the full record as one bounded span."
            >
              <input
                required
                name="span_id"
                defaultValue="record"
                pattern="[A-Za-z0-9_.:]{1,96}"
                disabled={!!preview}
              />
            </Field>
            <div className="field-wide">
              <Field label="Evidence scope">
                <textarea
                  required
                  name="scope"
                  rows={3}
                  maxLength={1000}
                  placeholder="What this record covers, and what it does not."
                  disabled={!!preview}
                />
              </Field>
            </div>
            {preview && (
              <div className="source-preview field-wide">
                <h3>
                  <Check size={18} />
                  The committed record
                </h3>
                <pre>{preview.text}</pre>
                <p className="mono">{preview.manifest.byte_digest}</p>
                <button type="button" className="text-button" onClick={() => setPreview(null)}>
                  Change the source
                </button>
              </div>
            )}
          </div>
        )}
        {type === 'correction' && (
          <div className="form-grid">
            <Field label="Original revision">
              <select
                required
                value={oldRevision}
                onChange={(e) => {
                  setOldRevision(e.target.value);
                  setDependencyId('');
                }}
              >
                <option value="">Choose the original</option>
                {revisions.map((r) => (
                  <option value={r.revision_id} key={r.revision_id}>
                    {r.revision_id}
                  </option>
                ))}
              </select>
            </Field>
            <Field label="Corrected revision">
              <select required name="new_revision">
                <option value="">Choose its successor</option>
                {revisions
                  .filter((r) => r.supersedes === oldRevision)
                  .map((r) => (
                    <option key={r.revision_id} value={r.revision_id}>
                      {r.revision_id}
                    </option>
                  ))}
              </select>
            </Field>
            <div className="field-wide">
              <Field
                label="Registered consumer decision"
                help="The proposition, materiality question and policy come from this locked registration."
              >
                <select
                  required
                  value={dependencyId}
                  onChange={(e) => setDependencyId(e.target.value)}
                >
                  <option value="">Choose a decision</option>
                  {matching.map((d) => (
                    <option key={d.dependency_id} value={d.dependency_id}>
                      {d.subject_id} ({d.dependency_id})
                    </option>
                  ))}
                </select>
              </Field>
            </div>
            <Field label="Correction reference">
              <input
                name="request_id"
                placeholder="correction.provider.2026"
                pattern="[A-Za-z0-9_.:]{1,96}"
              />
            </Field>
            <Field label="Assessment window (minutes)" help="Choose 5 minutes to 24 hours.">
              <input
                required
                name="assessment_minutes"
                type="number"
                min={5}
                max={1440}
                step={1}
                defaultValue={120}
              />
            </Field>
            <div className="form-note field-wide">
              <ShieldCheck size={20} />
              <p>
                The registered propositions are flagged as unresolved immediately when this request
                is applied. Future decisions pause while the assessment and delivery settle.
              </p>
            </div>
          </div>
        )}
        {type === 'dependency' && (
          <div className="form-grid">
            <Field label="Decision reference">
              <input
                name="dependency_id"
                required
                placeholder="provider.listing"
                pattern="[A-Za-z0-9_.:]{1,96}"
              />
            </Field>
            <Field label="Subject name">
              <input
                name="subject"
                required
                placeholder="provider_name"
                pattern="[A-Za-z0-9_.:]{1,96}"
              />
            </Field>
            <Field label="Consumer application">
              <select name="consumer_kind">
                <option value="PROVIDER_LISTING">Provider listing</option>
                <option value="DEPLOYMENT_APPROVAL">Deployment approval</option>
              </select>
            </Field>
            <Field label="Source revision">
              <select name="revision" required>
                <option value="">Choose a revision</option>
                {revisions.map((r) => (
                  <option key={r.revision_id} value={r.revision_id}>
                    {r.revision_id}
                  </option>
                ))}
              </select>
            </Field>
            <Field label="Proposition reference">
              <input
                name="proposition_id"
                required
                placeholder="security_assurance"
                pattern="[A-Za-z0-9_.:]{1,96}"
              />
            </Field>
            <Field label="Controlling span">
              <input name="span" required placeholder="record" pattern="[A-Za-z0-9_.:]{1,96}" />
            </Field>
            <div className="field-wide">
              <Field label="Proposition">
                <textarea
                  name="statement"
                  required
                  rows={2}
                  maxLength={1000}
                  placeholder="The exact assertion this decision depends on."
                />
              </Field>
            </div>
            <div className="field-wide">
              <Field
                label="Materiality question"
                help="A bounded question validators will rerun against any correction."
              >
                <textarea
                  name="question"
                  required
                  rows={2}
                  maxLength={1000}
                  placeholder="Would changing this assertion affect the intended authorization?"
                />
              </Field>
            </div>
            <Field label="Policy identifier">
              <input
                name="policy_id"
                required
                placeholder="assurance"
                pattern="[A-Za-z0-9_.:]{1,96}"
              />
            </Field>
            <Field label="Policy revision">
              <input
                name="policy_revision"
                type="number"
                required
                min={1}
                max={4294967295}
                defaultValue={1}
              />
            </Field>
            <div className="field-wide">
              <Field
                label="Controlling rule identifiers"
                help="Include every rule and exception in the registered policy, separated by commas."
              >
                <input name="rule_ids" required placeholder="approval, exception" />
              </Field>
            </div>
            <Field label="Topological rank" help="Every parent must have a smaller rank.">
              <input name="rank" type="number" required min={1} max={4294967295} defaultValue={1} />
            </Field>
            <Field
              label="Parent decisions"
              help="Separate registered parent identifiers with commas. Leave empty for a root."
            >
              <input name="parents" placeholder="provider.audit, provider.review" />
            </Field>
            <Field label="Authorization deadline">
              <input name="deadline" type="datetime-local" required />
            </Field>
            <div className="form-note field-wide">
              <ShieldCheck size={20} />
              <p>
                Your consumer agrees to quarantine unresolved evidence and accept replacement
                evidence explicitly. Historical irreversible actions stay in the historical record.
              </p>
            </div>
          </div>
        )}
        {error && (
          <div className="form-error" role="alert">
            <AlertCircle size={18} />
            {error}
          </div>
        )}
        <div className="form-actions">
          <button type="button" className="secondary" onClick={onClose}>
            Cancel
          </button>
          <button
            type={authenticated ? 'submit' : 'button'}
            className="primary"
            disabled={busy}
            onClick={authenticated ? undefined : signIn}
          >
            {busy
              ? 'Working on it…'
              : !authenticated
                ? 'Sign in with email'
                : type === 'source' && !preview
                  ? 'Inspect the record'
                  : type === 'source'
                    ? 'Commit this revision'
                    : type === 'correction'
                      ? 'Open correction'
                      : 'Register dependency'}
            {!busy && <Plus size={16} />}
          </button>
        </div>
        <p className="form-footnote">
          You sign in. We handle the transaction. Its receipt stays in your request history.
        </p>
      </form>
    </section>
  );
}
