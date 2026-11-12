'use client';
import { useCallback, useEffect, useState } from 'react';
import { usePrivy } from '@privy-io/react-auth';
import {
  Inbox,
  GitBranch,
  FileText,
  History,
  ShieldCheck,
  Sun,
  Moon,
  Plus,
  Search,
  RefreshCw,
  LogOut,
  ChevronRight,
  ChevronDown,
  ArrowUpRight,
  Check,
  AlertCircle,
  CornerDownRight,
  BookOpen,
  SlidersHorizontal,
  Mail,
  ExternalLink,
} from 'lucide-react';
import { diffWordsWithSpace } from 'diff';
import { Logo } from './logo';
import { RequestForm } from './request-form';
import { type Snapshot, type Incident, type Command, type Dependency } from '@/lib/shared/schema';
import { affectedDependencies } from '@/lib/shared/affected';
import { humanStatus } from '@/lib/shared/canonical';
import { assessmentDeadline } from '@/lib/shared/assessment-window';
const tabs = [
  { id: 'inbox', name: 'Correction inbox', icon: Inbox },
  { id: 'sources', name: 'Source library', icon: FileText },
  { id: 'map', name: 'Dependency map', icon: GitBranch },
  { id: 'applications', name: 'My applications', icon: ShieldCheck },
  { id: 'timeline', name: 'Incident timeline', icon: History },
] as const;
type Tab = (typeof tabs)[number]['id'];
function Status({ value }: { value: string }) {
  return (
    <span
      className={`status ${['UNRESOLVED', 'TIMEOUT', 'DELIVERY_FAILED', 'QUARANTINED', 'RETRACTION', 'CONTRADICTION'].includes(value) ? 'restricted' : value === 'FINALIZED' || value === 'CLEAR' ? 'settled' : ''}`}
    >
      <span className="status-dot" />
      {humanStatus(value)}
    </span>
  );
}
function short(value: string) {
  return `${value.slice(0, 8)}…${value.slice(-5)}`;
}
export function Workspace() {
  const { ready, authenticated, login, logout, getAccessToken, user } = usePrivy();
  const [tab, setTab] = useState<Tab>('inbox'),
    [theme, setTheme] = useState('light'),
    [snapshot, setSnapshot] = useState<Snapshot | null>(null),
    [error, setError] = useState<string | null>(null),
    [loading, setLoading] = useState(true),
    [selected, setSelected] = useState<string | null>(null),
    [query, setQuery] = useState(''),
    [filter, setFilter] = useState('all'),
    [form, setForm] = useState<'source' | 'correction' | 'dependency' | null>(null),
    [pending, setPending] = useState(false),
    [feedback, setFeedback] = useState<string | null>(null);
  const load = useCallback(async () => {
    try {
      const token = authenticated ? await getAccessToken() : null;
      const response = await fetch('/api/snapshot', {
        headers: token ? { Authorization: `Bearer ${token}` } : {},
        cache: 'no-store',
      });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error);
      setSnapshot(data);
      setError(null);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'The network is taking a moment. Try refreshing.');
    } finally {
      setLoading(false);
    }
  }, [authenticated, getAccessToken]);
  useEffect(() => {
    void load();
    const timer = setInterval(() => {
      if (!document.hidden) void load();
    }, 30000);
    return () => clearInterval(timer);
  }, [load]);
  useEffect(() => {
    const stored = localStorage.getItem('corrigenda.theme');
    const mode =
      stored ?? (window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light');
    setTheme(mode);
    document.documentElement.dataset.theme = mode;
    const hash = window.location.hash.slice(1);
    if (tabs.some((t) => t.id === hash)) setTab(hash as Tab);
  }, []);
  function toggleTheme() {
    const mode = theme === 'light' ? 'dark' : 'light';
    setTheme(mode);
    document.documentElement.dataset.theme = mode;
    localStorage.setItem('corrigenda.theme', mode);
  }
  function navigate(id: Tab) {
    setTab(id);
    setForm(null);
    window.history.replaceState(null, '', `#${id}`);
  }
  const send = async (input: Command) => {
    if (!authenticated) {
      login({ loginMethods: ['email'] });
      return false;
    }
    setPending(true);
    setFeedback(null);
    try {
      const token = await getAccessToken();
      const response = await fetch('/api/commands', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
        body: JSON.stringify(input),
      });
      const result = await response.json();
      if (!response.ok) throw new Error(result.error);
      setFeedback('Request received. We will keep its progress here.');
      await load();
      return true;
    } catch (e) {
      setFeedback(
        e instanceof Error ? e.message : 'We could not send that request. Please try again.',
      );
      return false;
    } finally {
      setPending(false);
    }
  };
  const incidents = (snapshot?.incidents ?? []).filter(
    (i) =>
      (!query ||
        `${i.request_id} ${i.subject_id} ${i.propositions.map((p) => p.statement).join(' ')}`
          .toLowerCase()
          .includes(query.toLowerCase())) &&
      (filter === 'all' ||
        (filter === 'attention' && ['UNRESOLVED', 'PENDING', 'TIMEOUT'].includes(i.status)) ||
        (filter === 'finalized' && i.status === 'FINALIZED')),
  );
  const incident = snapshot?.incidents.find((i) => i.request_id === selected);
  const attention = (snapshot?.incidents ?? []).filter((i) =>
    ['UNRESOLVED', 'PENDING', 'TIMEOUT'].includes(i.status),
  ).length;
  const applications = (snapshot?.dependencies ?? []).filter(
    (d) => d.owner.toLowerCase() === snapshot?.user?.address.toLowerCase(),
  );
  return (
    <div className="app-shell">
      <a className="skip-link" href="#main">
        Skip to workspace
      </a>
      <aside className="sidebar">
        <a className="brand" href="#inbox" onClick={() => navigate('inbox')}>
          <span className="brand-mark">
            <Logo small />
          </span>
          <span>
            Corrigenda<span className="brand-sub">Good evidence travels.</span>
          </span>
        </a>
        <nav aria-label="Main navigation">
          {tabs.map((t) => (
            <button
              key={t.id}
              className={`nav-item ${tab === t.id ? 'active' : ''}`}
              onClick={() => navigate(t.id)}
              aria-current={tab === t.id ? 'page' : undefined}
            >
              <t.icon size={19} />
              <span>{t.name}</span>
              {t.id === 'inbox' && attention > 0 && <span className="nav-count">{attention}</span>}
            </button>
          ))}
        </nav>
        <div className="sidebar-note">
          <div className="sidebar-bracket">
            <Logo />
          </div>
          <p>
            Facts change.
            <br />
            Their consequences
            <br />
            should catch up.
          </p>
          <span>
            Made for the moment
            <br />
            the record needs correcting.
          </span>
        </div>
        <div className="sidebar-bottom">
          <a
            href="https://github.com/dotmantissa/corrigenda#readme"
            target="_blank"
            rel="noreferrer"
          >
            <BookOpen size={17} />
            Field guide
            <ArrowUpRight size={14} />
          </a>
          <span className="network-caption">
            <span className={error ? 'offline-dot' : 'live-dot'} />
            {snapshot?.network ?? 'GenLayer Studio'}
            <span className="mono">61999</span>
          </span>
        </div>
      </aside>
      <div className="main-shell">
        <header className="topbar">
          <div className="breadcrumb">
            <a
              className="mobile-brand icon-button"
              href="#inbox"
              aria-label="Corrigenda inbox"
              onClick={() => navigate('inbox')}
            >
              <Logo small />
            </a>
            <span>Workspace</span>
            <ChevronRight size={14} />
            <strong>{tabs.find((t) => t.id === tab)?.name}</strong>
          </div>
          <div className="account-controls">
            <button
              className="icon-button theme-button"
              aria-label={theme === 'light' ? 'Switch to dark mode' : 'Switch to light mode'}
              onClick={toggleTheme}
            >
              {theme === 'light' ? <Moon size={18} /> : <Sun size={18} />}
            </button>
            {authenticated ? (
              <>
                <span className="account-email">{user?.email?.address}</span>
                <button className="icon-button" aria-label="Sign out" onClick={() => void logout()}>
                  <LogOut size={18} />
                </button>
              </>
            ) : (
              <button
                className="sign-in"
                disabled={!ready}
                onClick={() => login({ loginMethods: ['email'] })}
              >
                <Mail size={16} />
                Sign in with email
              </button>
            )}
          </div>
        </header>
        <nav className="mobile-tabs" aria-label="Workspace navigation">
          {tabs.map((t) => (
            <button
              key={t.id}
              onClick={() => navigate(t.id)}
              aria-current={tab === t.id ? 'page' : undefined}
            >
              {t.id === 'inbox'
                ? 'Inbox'
                : t.id === 'sources'
                  ? 'Sources'
                  : t.id === 'map'
                    ? 'Dependencies'
                    : t.id === 'applications'
                      ? 'Applications'
                      : 'Timeline'}
            </button>
          ))}
        </nav>
        <main id="main" tabIndex={-1}>
          <div className="page-heading">
            <div>
              <h1>
                {tab === 'inbox'
                  ? 'Keep the record straight.'
                  : tab === 'sources'
                    ? 'Every claim starts somewhere.'
                    : tab === 'map'
                      ? 'Follow the consequences.'
                      : tab === 'applications'
                        ? 'Evidence your applications can trust.'
                        : 'The story, as it happened.'}
              </h1>
              <p>
                {tab === 'inbox'
                  ? 'A correction is only the beginning. Make sure it reaches everyone who relied on it.'
                  : tab === 'sources'
                    ? 'Committed revisions, clear provenance, and a place for the next chapter.'
                    : tab === 'map'
                      ? 'See which decisions lean on which propositions. No guesswork required.'
                      : tab === 'applications'
                        ? 'When the evidence changes, future decisions pause until you have put things right.'
                        : 'From the first changed statement to the last acknowledgement.'}
              </p>
            </div>
            <button
              className="secondary refresh-button"
              aria-label="Refresh workspace"
              onClick={() => void load()}
              disabled={loading || pending}
            >
              <RefreshCw size={16} />
              <span>Refresh</span>
            </button>
          </div>
          {error && (
            <div role="alert" className="error-banner">
              <AlertCircle size={20} />
              <div>
                <strong>The connection needs a moment.</strong>
                <p>{error}</p>
              </div>
              <button className="text-button" onClick={() => void load()}>
                Try again
              </button>
            </div>
          )}
          {feedback && (
            <div role="status" className="feedback">
              <Check size={18} />
              {feedback}
              <button className="text-button" onClick={() => setFeedback(null)}>
                Dismiss
              </button>
            </div>
          )}
          {form ? (
            <RequestForm
              type={form}
              snapshot={snapshot}
              onClose={() => setForm(null)}
              send={send}
              authenticated={authenticated}
              signIn={() => login({ loginMethods: ['email'] })}
              getToken={getAccessToken}
            />
          ) : (
            <>
              {tab === 'inbox' && (
                <div className="workspace-columns">
                  <section className="inbox-area" aria-label="Corrections">
                    <div className="section-top">
                      <h2>
                        Correction inbox
                        <span className="count">{snapshot?.incidents.length ?? 0}</span>
                      </h2>
                      <button className="primary" onClick={() => setForm('correction')}>
                        <Plus size={17} />
                        New correction
                      </button>
                    </div>
                    <div className="filter-row">
                      <label className="search-input">
                        <Search size={17} />
                        <input
                          aria-label="Search corrections"
                          placeholder="Find a claim, source, or decision"
                          value={query}
                          onChange={(e) => setQuery(e.target.value)}
                        />
                      </label>
                      <label className="filter-select">
                        <SlidersHorizontal size={16} />
                        <select
                          aria-label="Filter corrections"
                          value={filter}
                          onChange={(e) => setFilter(e.target.value)}
                        >
                          <option value="all">All corrections</option>
                          <option value="attention">Needs attention</option>
                          <option value="finalized">Finalized</option>
                        </select>
                        <ChevronDown size={14} />
                      </label>
                    </div>
                    {loading ? (
                      <div className="loading-state" role="status">
                        <RefreshCw size={20} />
                        <p>Reading the correction network…</p>
                      </div>
                    ) : incidents.length ? (
                      <div className="incident-list">
                        {incidents.map((i) => (
                          <button
                            className={`incident-row ${selected === i.request_id ? 'selected' : ''}`}
                            key={i.request_id}
                            onClick={() => setSelected(i.request_id)}
                          >
                            <div className="incident-glyph">
                              <FileText size={22} />
                            </div>
                            <div className="incident-summary">
                              <span className="mono incident-id">{i.request_id}</span>
                              <h3>{i.propositions[0]?.statement ?? i.subject_id}</h3>
                              <div className="incident-meta">
                                <Status value={i.status} />
                                <span>
                                  Generation <span className="mono">{i.generation}</span>
                                </span>
                              </div>
                            </div>
                            <ChevronRight size={18} />
                          </button>
                        ))}
                      </div>
                    ) : (
                      <div className="inbox-empty">
                        <div className="empty-bracket">
                          <span />
                          <Inbox size={38} />
                          <span />
                        </div>
                        <h3>
                          {query || filter !== 'all'
                            ? 'Nothing matches this view.'
                            : 'Nothing needs correcting. Yet.'}
                        </h3>
                        <p>
                          {query || filter !== 'all'
                            ? 'Try another search or open the full inbox.'
                            : 'Start with a source and the decisions that rely on it. When the record changes, this is where the work begins.'}
                        </p>
                        <button
                          className="secondary"
                          onClick={() => {
                            if (query || filter !== 'all') {
                              setQuery('');
                              setFilter('all');
                            } else {
                              setForm('source');
                            }
                          }}
                        >
                          {query || filter !== 'all'
                            ? 'Clear filters'
                            : 'Register your first source'}
                          <Plus size={16} />
                        </button>
                      </div>
                    )}
                    <div className="inbox-foot">
                      <ShieldCheck size={16} />
                      <span>Quarantine starts at the source, even before a notice arrives.</span>
                    </div>
                    {incident && (
                      <IncidentDetails
                        incident={incident}
                        dependencies={snapshot?.dependencies ?? []}
                        notices={snapshot?.notices ?? []}
                        accountAddress={snapshot?.user?.address}
                        send={send}
                        pending={pending}
                      />
                    )}
                  </section>
                  <aside className="context-rail">
                    <div className="rail-heading">
                      <GitBranch size={22} />
                      <h2>A change has a trail.</h2>
                    </div>
                    <p className="rail-description">
                      One corrected passage. Every decision that needs another look.
                    </p>
                    <div className="proof-path">
                      <div>
                        <FileText size={19} />
                        <span>
                          Source revision<small>What the publisher changed</small>
                        </span>
                      </div>
                      <div className="path-connector" />
                      <div>
                        <ShieldCheck size={19} />
                        <span>
                          Impact certificate<small>What validators agreed on</small>
                        </span>
                      </div>
                      <div className="path-connector" />
                      <div>
                        <GitBranch size={19} />
                        <span>
                          Dependent decisions<small>Where the correction lands</small>
                        </span>
                      </div>
                    </div>
                    <section className="remediation-summary">
                      <h3>Remediation queue</h3>
                      {(snapshot?.dependencies ?? []).some((d) => !d.usable) ? (
                        (snapshot?.dependencies ?? [])
                          .filter((d) => !d.usable)
                          .slice(0, 6)
                          .map((d) => (
                            <button key={d.dependency_id} onClick={() => navigate('applications')}>
                              <span>{d.subject_id}</span>
                              <Status value="QUARANTINED" />
                            </button>
                          ))
                      ) : (
                        <p>
                          No decisions waiting on replacement evidence. A little breathing room.
                        </p>
                      )}
                    </section>
                    <div className="rail-bottom">
                      <span className="mono">8 propositions</span>
                      <span className="mono">20 deliveries per page</span>
                      <p>
                        Small, deliberate batches.
                        <br />A smaller blast radius.
                      </p>
                    </div>
                  </aside>
                </div>
              )}
              {tab === 'sources' && (
                <section className="full-section">
                  <div className="section-top">
                    <h2>
                      Registered revisions
                      <span className="count">{snapshot?.revisions.length ?? 0}</span>
                    </h2>
                    <button className="primary" onClick={() => setForm('source')}>
                      <Plus size={17} />
                      Register a source
                    </button>
                  </div>
                  {snapshot?.revisions.length ? (
                    <div className="source-table">
                      <div className="table-head">
                        <span>Source and revision</span>
                        <span>Committed record</span>
                        <span>Scope</span>
                        <span>Original</span>
                      </div>
                      {snapshot.revisions.map((r) => (
                        <div className="source-row" key={r.revision_id}>
                          <span>
                            <strong>{r.source_id}</strong>
                            <small className="mono">{r.revision_id}</small>
                          </span>
                          <span className="mono" title={r.byte_digest}>
                            {short(r.byte_digest)}
                            <small>{r.byte_size.toLocaleString()} bytes</small>
                          </span>
                          <span>{r.scope}</span>
                          <a
                            href={r.url}
                            target="_blank"
                            rel="noreferrer"
                            className="icon-button"
                            aria-label={`Open ${r.revision_id} original`}
                          >
                            <ExternalLink size={18} />
                          </a>
                        </div>
                      ))}
                    </div>
                  ) : (
                    <Empty
                      icon={FileText}
                      title="Give the evidence a home."
                      text="Register an authentic public record. Its byte commitment and exact spans will stay put, even when the next revision arrives."
                    />
                  )}
                </section>
              )}
              {tab === 'map' && (
                <section className="full-section">
                  <div className="section-top">
                    <h2>Registered dependencies</h2>
                    <button className="primary" onClick={() => setForm('dependency')}>
                      <Plus size={17} />
                      Add a dependency
                    </button>
                  </div>
                  {snapshot?.dependencies.length ? (
                    <DependencyMap dependencies={snapshot.dependencies} />
                  ) : (
                    <Empty
                      icon={GitBranch}
                      title="The first connection is yours."
                      text="Link a consumer decision to a proposition. Its descendants will carry that reference, so corrections cannot get lost in the middle."
                    />
                  )}
                </section>
              )}
              {tab === 'applications' && (
                <section className="full-section">
                  <div className="section-top">
                    <h2>Your consumer applications</h2>
                    <button className="primary" onClick={() => setForm('dependency')}>
                      <Plus size={17} />
                      Register a decision
                    </button>
                  </div>
                  {!authenticated ? (
                    <Empty
                      icon={Mail}
                      title="Your applications, one email away."
                      text="Sign in to register decisions and accept replacement evidence. We take care of the transactions."
                      action={
                        <button
                          className="primary"
                          onClick={() => login({ loginMethods: ['email'] })}
                        >
                          Sign in with email
                        </button>
                      }
                    />
                  ) : !snapshot?.user?.listing_consumer ? (
                    <Empty
                      icon={ShieldCheck}
                      title="Two consumers. One clear boundary."
                      text="Set up your provider listing and deployment approval adapters. Each belongs to your account and checks the evidence before acting."
                      action={
                        <button
                          className="primary"
                          disabled={pending}
                          onClick={() =>
                            void send({
                              kind: 'deploy_consumers',
                              operation_id: `adapters.${Date.now()}`,
                            })
                          }
                        >
                          {pending ? 'Setting things in motion…' : 'Set up my applications'}
                        </button>
                      }
                    />
                  ) : (
                    <>
                      <div className="adapter-strip">
                        <span>
                          <ShieldCheck size={18} />
                          Provider listings
                          <small className="mono">{short(snapshot.user.listing_consumer)}</small>
                        </span>
                        <span>
                          <GitBranch size={18} />
                          Deployment approvals
                          <small className="mono">
                            {snapshot.user.deployment_consumer
                              ? short(snapshot.user.deployment_consumer)
                              : 'Setup in progress'}
                          </small>
                        </span>
                      </div>
                      {applications.length ? (
                        applications.map((d) => (
                          <ConsumerDecision
                            key={d.dependency_id}
                            dependency={d}
                            snapshot={snapshot}
                            send={send}
                            pending={pending}
                          />
                        ))
                      ) : (
                        <Empty
                          icon={FileText}
                          title="Ready for your first decision."
                          text="Register the proposition your application relies on. It is a small step now, and a useful breadcrumb later."
                        />
                      )}
                    </>
                  )}
                  {snapshot?.operations.length ? (
                    <section className="operation-section">
                      <h3>Your request history</h3>
                      {snapshot.operations.map((o) => (
                        <div className="operation-row" key={o.id}>
                          <span>
                            {humanStatus(o.kind)}
                            <small className="mono">{o.id}</small>
                          </span>
                          <Status value={o.status} />
                          {o.hash && (
                            <a
                              className="text-button"
                              href={`https://studio.genlayer.com/transactions/${o.hash}`}
                              target="_blank"
                              rel="noreferrer"
                            >
                              Receipt
                              <ArrowUpRight size={14} />
                            </a>
                          )}
                        </div>
                      ))}
                    </section>
                  ) : null}
                </section>
              )}
              {tab === 'timeline' && (
                <section className="full-section">
                  <div className="section-top">
                    <h2>Incident timeline</h2>
                    <span className="muted">Recorded by the contracts</span>
                  </div>
                  {snapshot?.timeline.length ? (
                    <ol className="timeline">
                      {snapshot.timeline.map((event, i) => (
                        <li key={`${event.contract}.${event.sequence}.${i}`}>
                          <div className="timeline-marker">
                            <Check size={14} />
                          </div>
                          <div>
                            <h3>{humanStatus(event.event)}</h3>
                            <p>
                              {event.request_id ?? event.dependency_id ?? 'Network configuration'}
                            </p>
                            <span className="mono">
                              {event.generation
                                ? `Generation ${event.generation}`
                                : `Record ${event.sequence}`}
                            </span>
                            {event.operation_id && (
                              <details>
                                <summary>Operation details</summary>
                                <p className="mono">{event.operation_id}</p>
                                <p className="mono">Source contract {short(event.contract)}</p>
                              </details>
                            )}
                          </div>
                          {event.status && <Status value={event.status} />}
                        </li>
                      ))}
                    </ol>
                  ) : (
                    <Empty
                      icon={History}
                      title="Every correction gets a paper trail."
                      text="Finalized assessments, delivery pages and acknowledgements will appear here. No invisible handoffs."
                    />
                  )}
                </section>
              )}
            </>
          )}
        </main>
        <footer className="workspace-footer">
          <span>Corrections with consequences.</span>
          <span>
            <span>
              {snapshot?.updated_at
                ? `Last indexed ${new Date(snapshot.updated_at).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}`
                : 'Waiting for the first indexed record'}
            </span>
            <span className="footer-separator" aria-hidden="true" />
            <span>Public incident handling is free.</span>
          </span>
        </footer>
      </div>
    </div>
  );
}
function Empty({
  icon: Icon,
  title,
  text,
  action,
}: {
  icon: typeof Inbox;
  title: string;
  text: string;
  action?: React.ReactNode;
}) {
  return (
    <div className="large-empty">
      <div className="empty-bracket">
        <span />
        <Icon size={38} />
        <span />
      </div>
      <h3>{title}</h3>
      <p>{text}</p>
      {action}
    </div>
  );
}
function DependencyMap({ dependencies }: { dependencies: Dependency[] }) {
  const ranks = Array.from(new Set(dependencies.map((d) => d.rank))).sort((a, b) => a - b);
  return (
    <div className="dependency-map">
      {ranks.map((rank) => (
        <section className="rank-column" key={rank}>
          <h3>
            Rank <span className="mono">{rank}</span>
          </h3>
          {dependencies
            .filter((d) => d.rank === rank)
            .map((d) => (
              <article className="dependency-node" key={d.dependency_id}>
                <div className="node-title">
                  <GitBranch size={17} />
                  <strong>{d.subject_id}</strong>
                </div>
                <span className="mono">{d.dependency_id}</span>
                <Status value={d.usable ? 'CLEAR' : 'QUARANTINED'} />
                {d.usable && d.last_applied_generation === 0 && (
                  <small>
                    Initial authorization is the owner’s attestation. Consensus evaluates subsequent
                    corrections.
                  </small>
                )}
                {d.parents.length > 0 && (
                  <p>
                    <CornerDownRight size={14} />
                    Depends on {d.parents.join(', ')}
                  </p>
                )}
                <details>
                  <summary>Evidence references</summary>
                  {d.ancestors.map((a, i) => (
                    <p className="mono" key={i}>
                      {a.revision}
                      <br />
                      {a.proposition}
                    </p>
                  ))}
                </details>
              </article>
            ))}
        </section>
      ))}
    </div>
  );
}
function IncidentDetails({
  incident,
  dependencies,
  notices,
  accountAddress,
  send,
  pending,
}: {
  incident: Incident;
  accountAddress?: string;
  dependencies: Dependency[];
  notices: Snapshot['notices'];
  send: (c: Command) => Promise<boolean>;
  pending: boolean;
}) {
  const [texts, setTexts] = useState<{ old: string; next: string } | null>(null),
    [error, setError] = useState<string | null>(null),
    [loading, setLoading] = useState(false);
  useEffect(() => {
    let active = true;
    setTexts(null);
    setError(null);
    setLoading(true);
    Promise.all(
      [incident.old_revision, incident.new_revision].map(async (revision) => {
        const r = await fetch(`/api/sources?revision=${encodeURIComponent(revision)}`);
        const data = await r.json();
        if (!r.ok) throw new Error(data.error);
        return data.text as string;
      }),
    )
      .then(([old, next]) => {
        if (active) setTexts({ old, next });
      })
      .catch((e) => {
        if (active) setError(e.message);
      })
      .finally(() => {
        if (active) setLoading(false);
      });
    return () => {
      active = false;
    };
  }, [incident.old_revision, incident.new_revision]);
  const affected = affectedDependencies(incident, dependencies, notices);
  const diff = texts ? diffWordsWithSpace(texts.old, texts.next) : [];
  return (
    <section className="incident-details">
      <div className="section-top">
        <h2>What changed</h2>
        <Status value={incident.status} />
      </div>
      <div className="correction-proof">
        <div className="revision-comparison">
          <div className="revision-half">
            <header>
              <span>Before</span>
              <span className="mono">{incident.old_revision}</span>
            </header>
            <div className="source-copy">
              {loading
                ? 'Retrieving the authentic record…'
                : (error ??
                  diff
                    .filter((d) => !d.added)
                    .map((d, i) => (
                      <span key={i} className={d.removed ? 'removed' : ''}>
                        {d.value}
                      </span>
                    )))}
            </div>
          </div>
          <div className="revision-half">
            <header>
              <span>After</span>
              <span className="mono">{incident.new_revision}</span>
            </header>
            <div className="source-copy">
              {loading
                ? 'Retrieving the authentic record…'
                : (error ??
                  diff
                    .filter((d) => !d.removed)
                    .map((d, i) => (
                      <span key={i} className={d.added ? 'added' : ''}>
                        {d.value}
                      </span>
                    )))}
            </div>
          </div>
        </div>
        {texts && (
          <p className="verified-source">
            <ShieldCheck size={15} />
            Both records match their committed bytes.
          </p>
        )}
        <div className="decision-vector">
          {incident.certificate?.decisions?.map((d) => (
            <div key={d.proposition_id}>
              <span className="mono">{d.proposition_id}</span>
              <Status value={d.impact} />
              <strong>{humanStatus(d.action)}</strong>
              <details>
                <summary>Controlling evidence</summary>
                <p>Rules: {d.rule_ids.join(', ')}</p>
                {d.witness_ids.map((w) => (
                  <p className="mono" key={w}>
                    {w}
                  </p>
                ))}
              </details>
            </div>
          ))}
        </div>
        <div className="section-top">
          <h3>
            Affected decisions<span className="count">{affected.length}</span>
          </h3>
          {incident.status === 'PENDING' && (
            <button
              className="secondary"
              disabled={pending || incident.attempts >= 3}
              onClick={() => void send({ kind: 'assess_impact', request_id: incident.request_id })}
            >
              {pending ? 'Sending request…' : 'Assess the impact'}
            </button>
          )}
        </div>
        {affected.map((d) => (
          <div key={d.dependency_id} className="affected-row">
            <CornerDownRight size={17} />
            <span>
              {d.subject_id}
              <small className="mono">{d.dependency_id}</small>
            </span>
            <Status value={d.usable ? 'CLEAR' : 'QUARANTINED'} />
            {d.usable && d.last_applied_generation === 0 && (
              <small>
                Initial authorization is the owner’s attestation. Consensus evaluates subsequent
                corrections.
              </small>
            )}
          </div>
        ))}
        {!affected.length && (
          <p className="muted">No registered decisions match these proposition references.</p>
        )}
        {incident.certificate?.unresolved && (
          <p className="unresolved-note">
            The evidence did not settle the question. Quarantine stays in place while this is
            unresolved.
          </p>
        )}
      </div>
      {['UNRESOLVED', 'TIMEOUT'].includes(incident.status) && (
        <RecoveryPanel
          incident={incident}
          recoveryOwner={accountAddress}
          send={send}
          pending={pending}
        />
      )}
      <DispatchPanel incident={incident} send={send} pending={pending} />
      <details className="certificate-details">
        <summary>Certificate bindings</summary>
        <dl>
          <dt>Policy</dt>
          <dd>
            {incident.policy_id} revision {incident.policy_revision}
          </dd>
          <dt>Generation</dt>
          <dd>{incident.generation}</dd>
          <dt>Deadline</dt>
          <dd>{new Date(incident.deadline * 1000).toLocaleString()}</dd>
          <dt>Manifest commitment</dt>
          <dd className="mono">{incident.source_manifest_digest}</dd>
          <dt>Subject commitment</dt>
          <dd className="mono">{incident.subject_digest}</dd>
        </dl>
      </details>
    </section>
  );
}
function ConsumerDecision({
  dependency: d,
  snapshot,
  send,
  pending,
}: {
  dependency: Dependency;
  snapshot: Snapshot;
  send: (c: Command) => Promise<boolean>;
  pending: boolean;
}) {
  const notices = snapshot.notices.filter((n) => n.dependency_id === d.dependency_id);
  return (
    <article className="consumer-decision">
      <div className="section-top">
        <div>
          <h3>{d.subject_id}</h3>
          <span className="mono">{d.dependency_id}</span>
        </div>
        <Status value={d.usable ? 'CLEAR' : 'QUARANTINED'} />
        {d.usable && d.last_applied_generation === 0 && (
          <small>
            Initial authorization is the owner’s attestation. Consensus evaluates subsequent
            corrections.
          </small>
        )}
      </div>
      <p>
        {d.kind === 'PROVIDER_LISTING' ? 'Provider listing' : 'Deployment approval'}
        <span className="footer-separator" /> Generation{' '}
        <span className="mono">{d.last_applied_generation}</span>
      </p>
      {d.restrictions.map((r, i) => (
        <div className="restriction-row" key={i}>
          <AlertCircle size={17} />
          <span>
            {r.proposition} in {r.revision}
            <small>{humanStatus(r.status)}</small>
          </span>
        </div>
      ))}
      {notices.map((n) => (
        <NoticeRemediation
          key={n.operation_id}
          notice={n}
          dependency={d}
          snapshot={snapshot}
          send={send}
          pending={pending}
        />
      ))}
      <button
        className="secondary"
        disabled={pending || !d.usable}
        onClick={() =>
          void send({
            kind: 'authorize',
            consumer: d.consumer,
            consumer_kind: d.kind as 'PROVIDER_LISTING' | 'DEPLOYMENT_APPROVAL',
            dependency_id: d.dependency_id,
            operation_id: `action.${Date.now()}`,
            consequence_digest: d.consequence_digest,
          })
        }
      >
        {d.kind === 'PROVIDER_LISTING' ? 'Authorize listing' : 'Approve deployment'}
        <ShieldCheck size={16} />
      </button>
    </article>
  );
}

function NoticeRemediation({
  notice: n,
  dependency: d,
  snapshot,
  send,
  pending,
}: {
  notice: Snapshot['notices'][number];
  dependency: Dependency;
  snapshot: Snapshot;
  send: (c: Command) => Promise<boolean>;
  pending: boolean;
}) {
  const candidates = snapshot.incidents.filter(
    (i) =>
      i.status === 'FINALIZED' &&
      i.policy_id === n.certificate.policy_id &&
      i.policy_revision === n.certificate.policy_revision &&
      !!i.contexts?.[n.proposition_id] &&
      i.contexts[n.proposition_id] === n.certificate.contexts?.[n.proposition_id] &&
      (() => {
        let revision = i.new_revision;
        for (let step = 0; step < 8; step++) {
          if (revision === n.certificate.new_revision) return true;
          revision = snapshot.revisions.find((r) => r.revision_id === revision)?.supersedes ?? '';
          if (!revision) return false;
        }
        return false;
      })() &&
      i.certificate?.decisions?.some(
        (v) => v.proposition_id === n.proposition_id && v.new_support === 'TRUE',
      ),
  );
  const [replacement, setReplacement] = useState('');
  const superseded = d.restrictions.some(
    (r) =>
      r.revision === n.certificate.old_revision &&
      r.proposition === n.proposition_id &&
      r.generation > n.certificate.generation,
  );
  return (
    <div className="notice-remediation">
      <div>
        <span>Correction {n.certificate.request_id}</span>
        <small>Generation {n.certificate.generation}</small>
        <Status value={n.status ?? 'BROADCAST'} />
      </div>
      {n.acknowledgement?.route === 'REFRESHED' ? (
        <div>
          <Status value="REFRESHED" />
          {n.acknowledgement.operation_id && (
            <button
              className="secondary"
              disabled={pending}
              onClick={() =>
                void send({
                  kind: 'replay_acknowledgement',
                  consumer: d.consumer,
                  operation_id: n.acknowledgement!.operation_id!,
                })
              }
            >
              Retry acknowledgement delivery
            </button>
          )}
        </div>
      ) : (
        <div className="remediation-controls">
          {n.acknowledgement?.route && <Status value={n.acknowledgement.route} />}
          <label className="form-field">
            <span>Replacement evidence</span>
            <select
              aria-label={`Replacement for ${n.operation_id}`}
              value={replacement}
              onChange={(e) => setReplacement(e.target.value)}
            >
              <option value="">Choose a finalized certificate</option>
              {candidates.map((i) => (
                <option key={i.request_id} value={i.request_id}>
                  {i.request_id} ({i.new_revision})
                </option>
              ))}
            </select>
          </label>
          <div className="button-group">
            <button
              className="secondary"
              disabled={pending || superseded}
              onClick={() =>
                void send({
                  kind: 'acknowledge_generation',
                  consumer: d.consumer,
                  operation_id: n.operation_id,
                  generation: n.certificate.generation,
                  route: 'QUARANTINED',
                })
              }
            >
              Keep quarantined
            </button>
            <button
              className="primary"
              disabled={pending || superseded || !replacement}
              onClick={() =>
                void send({
                  kind: 'acknowledge_generation',
                  consumer: d.consumer,
                  operation_id: n.operation_id,
                  generation: n.certificate.generation,
                  route: 'REFRESHED',
                  replacement_certificate_id: replacement,
                })
              }
            >
              Accept replacement
            </button>
          </div>
          {superseded && (
            <p>A newer generation controls this proposition. Use its notice to continue.</p>
          )}
        </div>
      )}
      <button
        className="text-button"
        disabled={pending}
        onClick={() => void send({ kind: 'replay_notice', operation_id: n.operation_id })}
      >
        <RefreshCw size={15} />
        Replay notice
      </button>
    </div>
  );
}
function DispatchPanel({
  incident,
  send,
  pending,
}: {
  incident: Incident;
  send: (c: Command) => Promise<boolean>;
  pending: boolean;
}) {
  const [pages, setPages] = useState<{ proposition_id: string; cursor: number; total: number }[]>(
      [],
    ),
    [message, setMessage] = useState('');
  useEffect(() => {
    let active = true;
    fetch(`/api/dispatch?request=${encodeURIComponent(incident.request_id)}`)
      .then(async (r) => {
        const result = await r.json();
        if (active) {
          setPages(result.pages ?? []);
          setMessage(result.error ?? '');
        }
      })
      .catch(() => {
        if (active) setMessage('Delivery progress is unavailable. Try refreshing the workspace.');
      });
    return () => {
      active = false;
    };
  }, [incident.request_id, incident.status]);
  return (
    <section className="dispatch-panel">
      <h3>Delivery journal</h3>
      <p>Pages are scheduled automatically. Replay a notice or continue a paused page here.</p>
      {message && <p className="muted">{message}</p>}
      {pages.map((p) => (
        <div className="dispatch-row" key={p.proposition_id}>
          <span className="mono">{p.proposition_id}</span>
          <span>
            {p.cursor} of {p.total} broadcast
          </span>
          <button
            className="secondary"
            disabled={pending || p.cursor >= p.total}
            onClick={() =>
              void send({
                kind: 'dispatch_page',
                request_id: incident.request_id,
                proposition_id: p.proposition_id,
                cursor: p.cursor,
                operation_id: `page.${crypto.randomUUID().replaceAll('-', '')}`,
              })
            }
          >
            {p.cursor >= p.total ? 'Pages complete' : 'Continue delivery'}
          </button>
        </div>
      ))}
    </section>
  );
}

function RecoveryPanel({
  incident,
  recoveryOwner,
  send,
  pending,
}: {
  incident: Incident;
  recoveryOwner?: string;
  send: (c: Command) => Promise<boolean>;
  pending: boolean;
}) {
  const [minutes, setMinutes] = useState('120'),
    [error, setError] = useState('');
  async function recover(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError('');
    try {
      if (!recoveryOwner) throw new Error('Sign in to open a recovery.');
      const response = await fetch('/api/generation'),
        value = await response.json();
      if (!response.ok) throw new Error(value.error);
      await send({
        kind: 'open_correction',
        payload: {
          request_id: `recovery.${crypto.randomUUID().replaceAll('-', '')}`,
          owner: recoveryOwner,
          parties: incident.parties,
          policy_id: incident.policy_id,
          policy_revision: incident.policy_revision,
          subject_id: incident.subject_id,
          subject_digest: incident.subject_digest,
          source_manifest_digest: incident.source_manifest_digest,
          consumer: incident.consumer,
          consequence_digest: incident.consequence_digest,
          generation: value.generation + 1,
          deadline: assessmentDeadline(value.network_time, Number(minutes)),
          old_revision: incident.old_revision,
          new_revision: incident.new_revision,
          propositions: incident.propositions,
          supersedes_request: incident.request_id,
        },
      });
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Recovery could not be opened. Try refreshing.');
    }
  }
  return (
    <section className="dispatch-panel">
      <h3>Give the record another hearing.</h3>
      <p>
        A recovery keeps the evidence and policy locked, and opens a new generation. The previous
        unresolved record stays visible.
      </p>
      {recoveryOwner ? (
        <form onSubmit={recover} className="dispatch-row">
          <label className="form-field">
            <span>Assessment window (minutes)</span>
            <input
              aria-label="Assessment window (minutes)"
              type="number"
              min={5}
              max={1440}
              step={1}
              required
              value={minutes}
              onChange={(e) => setMinutes(e.target.value)}
            />
          </label>
          <button className="primary" disabled={pending || !minutes}>
            Open recovery
          </button>
        </form>
      ) : (
        <p className="muted">
          Sign in to open recovery. Any account can recover the locked request while assessment
          eligibility remains available.
        </p>
      )}
      {error && <p role="alert">{error}</p>}
    </section>
  );
}
