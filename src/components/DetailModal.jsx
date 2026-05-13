import { useCallback, useEffect, useRef, useState } from 'react';
import { FIELDS, MISSION_TYPES, MCC_SERVICE, FOLLOWUP_SERVICE } from '../config.js';
import { fetchMccRequest, fetchFollowups, addFollowup } from '../service.js';
import { getToken } from '../auth.js';

const FOLLOWUP_AUTHOR_KEY = 'resl_kanban_followup_author_v1';

function loadAuthorPrefs() {
  const tok = getToken();
  const tokenName = tok?.fullName || tok?.username || '';
  try {
    const raw = localStorage.getItem(FOLLOWUP_AUTHOR_KEY);
    if (raw) {
      const saved = JSON.parse(raw);
      // If the previously-saved name looks like an AGOL username (the
      // old default before we started capturing fullName), upgrade it.
      if (saved.username && tok?.fullName &&
          saved.username === tok?.username && saved.username !== tok.fullName) {
        saved.username = tok.fullName;
      }
      // Also pull email from token if the saved record has none.
      if (!saved.email && tok?.email) saved.email = tok.email;
      return saved;
    }
  } catch { /* ignore */ }
  return {
    username: tokenName,
    position: '',
    agency:   '',
    phone:    '',
    email:    tok?.email || '',
  };
}
function saveAuthorPrefs(prefs) {
  try { localStorage.setItem(FOLLOWUP_AUTHOR_KEY, JSON.stringify(prefs)); } catch { /* ignore */ }
}

// Pretty-print a date+time field. Handles both:
//   • numeric epoch ms (the usual AGOL date type)
//   • ISO date strings (some fields like the Followups `entrydate` are
//     stored as `esriFieldTypeString`)
// Falls back to the raw string if neither parse works.
function fmtDateTime(v) {
  if (v == null || v === '') return null;
  // Numeric path
  const n = Number(v);
  if (Number.isFinite(n) && n > 0) {
    const d = new Date(n);
    if (!Number.isNaN(d.getTime())) return d.toLocaleString();
  }
  // String path
  const d2 = new Date(String(v));
  if (!Number.isNaN(d2.getTime())) return d2.toLocaleString();
  return String(v);
}

// Pretty-print a date-only field (epoch ms). AGOL stores date-only
// fields like item_mobilization / item_demobilization at UTC midnight;
// rendering with `timeZone: 'UTC'` keeps the displayed date matching
// what the user actually picked, regardless of their local timezone.
function fmtDate(v) {
  if (v == null || v === '') return null;
  const n = Number(v);
  if (!Number.isFinite(n) || n <= 0) return null;
  const d = new Date(n);
  if (Number.isNaN(d.getTime())) return null;
  return d.toLocaleDateString(undefined, {
    timeZone: 'UTC',
    month: 'numeric',
    day: 'numeric',
    year: 'numeric',
  });
}

const has = (v) => {
  if (v === null || v === undefined) return false;
  if (typeof v === 'string' && v.trim() === '') return false;
  return true;
};

// Helpers for the Resource section — equipment_count and personnel_count
// only apply to one kind each (per the Survey123 `relevant` rules).
const isEquipment = (r) => String(r?.resource_kind || '').toLowerCase().includes('equip');
const isTeam      = (r) => String(r?.resource_kind || '').toLowerCase().includes('team');

function Section({ title, rows }) {
  // Editable rows are always shown so users can fill in blanks; static
  // rows are hidden when empty.
  const visible = rows.filter((r) => r.editable || has(r.value));
  if (visible.length === 0) return null;
  return (
    <section className="modal-section">
      <h3>{title}</h3>
      <dl>
        {visible.map((r) => {
          if (!r.editable) {
            return (
              <div className={`modal-row${r.multi ? ' multi' : ''}`} key={r.label}>
                <dt>{r.label}</dt>
                <dd>{String(r.value)}</dd>
              </div>
            );
          }
          if (r.type === 'number') {
            return (
              <EditableNumberRow
                key={r.label}
                label={r.label}
                value={r.value}
                field={r.field}
                objectId={r.objectId}
                onUpdate={r.onUpdate}
              />
            );
          }
          return (
            <EditableSelectRow
              key={r.label}
              label={r.label}
              value={r.value}
              options={r.options}
              field={r.field}
              objectId={r.objectId}
              onUpdate={r.onUpdate}
            />
          );
        })}
      </dl>
    </section>
  );
}

function EditableSelectRow({ label, value, options, field, objectId, onUpdate }) {
  const [saving, setSaving] = useState(false);
  const [err,    setErr]    = useState('');

  // No onUpdate ⇒ read-only mode. Render the value as plain text the
  // same way a normal Row does, instead of a disabled-looking select.
  if (!onUpdate) {
    if (!has(value)) return null;
    return (
      <div className="modal-row">
        <dt>{label}</dt>
        <dd>{String(value)}</dd>
      </div>
    );
  }

  const handleChange = async (e) => {
    const newVal = e.target.value || null;
    setErr('');
    setSaving(true);
    try {
      await onUpdate(objectId, { [field]: newVal });
    } catch (ex) {
      setErr(ex.message || 'Save failed');
    } finally {
      setSaving(false);
    }
  };

  const display = value == null ? '' : String(value);
  // If the current value isn't in our canonical list, surface it anyway
  // so the user can see what's stored and pick a replacement.
  const opts = display && !options.includes(display)
    ? [display, ...options]
    : options;

  return (
    <div className="modal-row editable">
      <dt>{label}</dt>
      <dd>
        <select
          className="modal-edit-select"
          value={display}
          onChange={handleChange}
          disabled={saving}
        >
          {/* Blank option (no "Select" label) so the dropdown opens
              showing the existing value, not a CTA. The blank entry is
              still selectable for clearing the field. */}
          <option value="">{display ? '(clear)' : ''}</option>
          {opts.map((o) => (
            <option key={o} value={o}>{o}</option>
          ))}
        </select>
        {saving && <span className="muted small modal-edit-status">Saving…</span>}
        {!saving && err && <span className="error-text small modal-edit-status">{err}</span>}
      </dd>
    </div>
  );
}

// Editable integer input. Saves on blur or Enter — never on every
// keystroke. Renders as plain text when onUpdate isn't provided
// (read-only mode).
function EditableNumberRow({ label, value, field, objectId, onUpdate }) {
  const initial = value == null || value === '' ? '' : String(value);
  const [local,   setLocal]   = useState(initial);
  const [saving,  setSaving]  = useState(false);
  const [err,     setErr]     = useState('');

  // Sync local state when the row's value changes externally
  // (e.g., optimistic update, refresh).
  useEffect(() => { setLocal(initial); }, [initial]);

  if (!onUpdate) {
    if (!has(value)) return null;
    return (
      <div className="modal-row">
        <dt>{label}</dt>
        <dd>{String(value)}</dd>
      </div>
    );
  }

  const commit = async () => {
    const trimmed = local.trim();
    const parsed  = trimmed === '' ? null : parseInt(trimmed, 10);
    if (trimmed !== '' && (!Number.isFinite(parsed) || parsed < 0)) {
      setErr('Must be a non-negative whole number.');
      return;
    }
    // No-op when unchanged
    if ((parsed == null ? '' : String(parsed)) === initial) {
      setErr('');
      return;
    }
    setErr('');
    setSaving(true);
    try {
      await onUpdate(objectId, { [field]: parsed });
    } catch (ex) {
      setErr(ex.message || 'Save failed');
      setLocal(initial);
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="modal-row editable">
      <dt>{label}</dt>
      <dd>
        <input
          className="modal-edit-input"
          type="number"
          min="0"
          step="1"
          inputMode="numeric"
          value={local}
          onChange={(e) => setLocal(e.target.value)}
          onBlur={commit}
          onKeyDown={(e) => {
            if (e.key === 'Enter') { e.preventDefault(); e.currentTarget.blur(); }
            if (e.key === 'Escape') { setLocal(initial); setErr(''); e.currentTarget.blur(); }
          }}
          disabled={saving}
        />
        {saving && <span className="muted small modal-edit-status">Saving…</span>}
        {!saving && err && <span className="error-text small modal-edit-status">{err}</span>}
      </dd>
    </div>
  );
}

export default function DetailModal({ r, onClose, onUpdate }) {
  const [activeTab, setActiveTab] = useState('resource'); // 'resource' | 'mcc' | 'followups'

  // MCC tab state (single record).
  const [mccState, setMccState] = useState({ status: 'idle', data: null, error: '' });
  const mccFetchedFor = useRef(null);

  // Followups tab state (array of records).
  const [fuState, setFuState] = useState({ status: 'idle', data: [], error: '' });
  const fuFetchedFor = useRef(null);
  const fuTriggeredFor = useRef(null);
  const [showComposer, setShowComposer] = useState(false);

  // ESC closes the modal
  useEffect(() => {
    if (!r) return;
    const onKey = (e) => { if (e.key === 'Escape') onClose(); };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [r, onClose]);

  // Reset tab + caches whenever a different row is shown (or modal closes).
  useEffect(() => {
    setActiveTab('resource');
    setMccState({ status: 'idle', data: null, error: '' });
    setFuState({ status: 'idle', data: [], error: '' });
    setShowComposer(false);
    mccFetchedFor.current = null;
    fuFetchedFor.current = null;
    fuTriggeredFor.current = null;
  }, [r && r.objectid]);

  // Lazy-load the MCC record the first time the user opens the tab for
  // this row. No cleanup/cancel flag — the fetch always completes; we
  // just check the ref before applying the result to make sure the row
  // hasn't been swapped out from under us.
  useEffect(() => {
    if (!r) return;
    if (activeTab !== 'mcc') return;
    const myToken = r.objectid;
    if (mccFetchedFor.current === myToken) return;   // already attempted
    mccFetchedFor.current = myToken;

    setMccState({ status: 'loading', data: null, error: '' });
    fetchMccRequest({
      requestNumber: r.request_number_rpt,
      missionId:     r.mission_id_rpt,
    })
      .then((data) => {
        if (mccFetchedFor.current !== myToken) return; // row changed mid-flight
        setMccState({ status: data ? 'loaded' : 'empty', data: data || null, error: '' });
      })
      .catch((err) => {
        if (mccFetchedFor.current !== myToken) return;
        setMccState({ status: 'error', data: null, error: err.message || String(err) });
      });
  }, [activeTab, r]);

  // Callable fetch for the Followups tab — used both by the lazy-load
  // effect (on first tab open) and by the post-add refresh.
  const reloadFollowups = useCallback(() => {
    if (!r) return;
    const token = Symbol(`followups-${r.objectid}-${Date.now()}`);
    fuFetchedFor.current = token;
    setFuState({ status: 'loading', data: [], error: '' });
    fetchFollowups({
      requestNumber: r.request_number_rpt,
      missionId:     r.mission_id_rpt,
    })
      .then((data) => {
        if (fuFetchedFor.current !== token) return;
        setFuState({ status: data.length ? 'loaded' : 'empty', data, error: '' });
      })
      .catch((err) => {
        if (fuFetchedFor.current !== token) return;
        setFuState({ status: 'error', data: [], error: err.message || String(err) });
      });
  }, [r]);

  // First-open trigger — only fires once per (tab, row) combination.
  useEffect(() => {
    if (!r) return;
    if (activeTab !== 'followups') return;
    if (fuTriggeredFor.current === r.objectid) return;
    fuTriggeredFor.current = r.objectid;
    reloadFollowups();
  }, [activeTab, r, reloadFollowups]);

  if (!r) return null;

  const reqNum = r.request_number_rpt;
  const title  = reqNum ? `Request #${reqNum}` : 'Resource details';

  return (
    <div className="modal-backdrop" onClick={onClose}>
      <div
        className="modal"
        role="dialog"
        aria-modal="true"
        onClick={(e) => e.stopPropagation()}
      >
        <header className="modal-header">
          <div>
            <div className="modal-eyebrow muted small">
              {r.item_status || '—'}{r.county_rpt ? ` · ${r.county_rpt} County` : ''}
            </div>
            <h2>{title}</h2>
          </div>
          <button className="modal-close" onClick={onClose} aria-label="Close">×</button>
        </header>

        <div className="modal-tabs" role="tablist">
          <button
            type="button"
            role="tab"
            aria-selected={activeTab === 'resource'}
            className={`modal-tab${activeTab === 'resource' ? ' is-active' : ''}`}
            onClick={() => setActiveTab('resource')}
          >
            Resource
          </button>
          <button
            type="button"
            role="tab"
            aria-selected={activeTab === 'mcc'}
            className={`modal-tab${activeTab === 'mcc' ? ' is-active' : ''}`}
            onClick={() => setActiveTab('mcc')}
            title="Original MCC request from the county"
          >
            MCC Request
          </button>
          <button
            type="button"
            role="tab"
            aria-selected={activeTab === 'followups'}
            className={`modal-tab${activeTab === 'followups' ? ' is-active' : ''}`}
            onClick={() => setActiveTab('followups')}
            title="Follow-up notes tied to this request"
          >
            Followups
          </button>
        </div>

        {activeTab === 'mcc' ? (
          <MccTabBody state={mccState} />
        ) : activeTab === 'followups' ? (
          <FollowupsTabBody
            state={fuState}
            canEdit={!!onUpdate}
            resource={r}
            showComposer={showComposer}
            onOpenComposer={() => setShowComposer(true)}
            onCancelComposer={() => setShowComposer(false)}
            onSubmitted={() => {
              setShowComposer(false);
              reloadFollowups();
            }}
          />
        ) : (
        <div className="modal-body">
          <Section title="Resource" rows={[
            { label: 'Kind',            value: r.resource_kind },
            { label: 'Type',            value: r.resource_type },
            { label: 'Description',     value: r.resource_main },
            { label: 'Equipment',       value: r.equipment },
            { label: 'Equipment type',  value: r.equipment_type },
            // Show equipment_count editor only for Equipment resources.
            // Saving it also writes qty_item to keep Survey123's
            // calculated quantity in sync (Survey123 only recalculates
            // at form-submit time; direct edits via this app bypass it).
            !isTeam(r) && {
              label: 'Equipment count',
              value: r.equipment_count,
              editable: true,
              type: 'number',
              field: 'equipment_count',
              objectId: r[FIELDS.objectId],
              onUpdate: onUpdate
                ? (oid, partial) => onUpdate(oid, {
                    ...partial,
                    qty_item: partial.equipment_count,
                  })
                : undefined,
            },
            { label: 'Team kind',       value: r.team_kind },
            // Show personnel_count editor only for Team resources.
            !isEquipment(r) && {
              label: 'Personnel',
              value: r.personnel_count,
              editable: true,
              type: 'number',
              field: 'personnel_count',
              objectId: r[FIELDS.objectId],
              onUpdate,
            },
            { label: 'Identifier',      value: r.identifier },
            { label: 'Tag #',           value: r.tag_number },
            { label: 'Item',            value: r.item },
            { label: 'Make',            value: r.make },
            { label: 'Serial',          value: r.serial },
          ].filter(Boolean)} />

          <Section title="Mission" rows={[
            { label: 'Mission',        value: r.mission_id_rpt },
            { label: 'Detail',         value: r.mission_detail_rpt },
            { label: 'Year',           value: r.mission_year_rpt },
            { label: 'Number',         value: r.mission_number_rpt },
            { label: 'Mission status', value: r.mission_status_rpt },
            { label: 'Coordinating ESF', value: r.coordinator },
            {
              label: 'Mission type',
              value: r[FIELDS.missionType],
              editable: true,
              options: MISSION_TYPES,
              field: FIELDS.missionType,
              objectId: r[FIELDS.objectId],
              onUpdate,
            },
          ]} />

          <Section title="Ownership / Request" rows={[
            { label: 'Entity',           value: r.entity_rpt },
            { label: 'Requestor',        value: r.requestor_rpt },
            { label: 'Requesting entity',value: r.requesting_entity_rpt },
            { label: 'State agency',     value: r.state_agency_rpt },
            { label: 'Vendor',           value: r.vendor_rpt },
            { label: 'Request #',        value: r.request_number_rpt },
            { label: 'Request ID',       value: r.request_id_rpt || r.rsa_full_rpt },
          ]} />

          <Section title="Location" rows={[
            { label: 'County',  value: r.county_rpt },
            { label: 'Region',  value: r.region_rpt },
            { label: 'Address', value: r.address_geo_rpt },
          ]} />

          <Section title="Status & Timing" rows={[
            { label: 'Status',             value: r.item_status },
            { label: 'Mobilization date',  value: fmtDate(r.item_mobilization) },
            { label: 'Expected arrival',   value: fmtDateTime(r.expected_arrival) },
            { label: 'Demobilization',     value: fmtDate(r.item_demobilization) },
            { label: 'Days deployed',      value: r.days_deployed },
            { label: 'Expected days',      value: r.expected_days_deployed },
          ]} />

          <Section title="Notes" rows={[
            { label: 'RESL note', value: r.resl_note, multi: true },
            { label: 'Notes',     value: r.note_rpt,  multi: true },
          ]} />

          <Section title="Audit" rows={[
            { label: 'Created', value: fmtDateTime(r.CreationDate) },
            { label: 'Creator', value: r.Creator },
            { label: 'Edited',  value: fmtDateTime(r.EditDate) },
            { label: 'Editor',  value: r.Editor },
          ]} />
        </div>
        )}
      </div>
    </div>
  );
}

// ─── MCC tab body ────────────────────────────────────────────────────
// Shows the matched MCC request from MCC_SERVICE. Lazily loaded — the
// modal passes us the state machine via `state` so we can render the
// idle/loading/loaded/empty/error variants without owning the fetch.
function MccTabBody({ state }) {
  if (state.status === 'idle' || state.status === 'loading') {
    return (
      <div className="modal-body modal-loading">
        <div className="spinner" />
        <p className="muted small">Loading MCC request…</p>
      </div>
    );
  }
  if (state.status === 'error') {
    return (
      <div className="modal-body">
        <div className="empty-banner">
          <strong>Couldn't load the MCC request.</strong>
          <div className="muted small">{state.error}</div>
        </div>
      </div>
    );
  }
  if (state.status === 'empty' || !state.data) {
    return (
      <div className="modal-body">
        <div className="picker-empty">
          <strong>No matching MCC request found.</strong>
          <p className="muted small">
            No record in <code>MCCStatusMapper2</code> matches this
            resource's request number + mission. The request may not
            have been entered, or the values may not line up.
          </p>
        </div>
      </div>
    );
  }

  const m = state.data;
  const f = MCC_SERVICE.fields;
  return (
    <div className="modal-body">
      <Section title="Request" rows={[
        { label: 'MCC #',     value: m[f.mccNumber] },
        { label: 'Subject',   value: m[f.subject] },
        { label: 'Type',      value: m[f.type] },
        { label: 'Priority',  value: m[f.priority] },
        { label: 'Status',    value: m[f.status] },
        { label: 'Lifeline',  value: m[f.lifeline] },
        { label: 'Feeding',   value: m[f.feeding] },
      ]} />

      <Section title="Description" rows={[
        { label: 'Description', value: m[f.description], multi: true },
      ]} />

      <Section title="Originator" rows={[
        { label: 'Originator', value: m[f.originator] },
        { label: 'Position',   value: m[f.mccPosition] },
        { label: 'MCC created', value: fmtDateTime(m[f.mccCreated]) },
        { label: 'Entry date',  value: fmtDateTime(m[f.entryDate]) },
      ]} />

      <Section title="Point of contact" rows={[
        { label: 'Name',       value: m[f.pocName] },
        { label: 'Title',      value: m[f.pocTitle] },
        { label: 'Phone',      value: m[f.pocPhone] },
        { label: 'Subscriber', value: m[f.subscriberName] },
      ]} />

      <Section title="Delivery" rows={[
        { label: 'Delivery date',     value: fmtDate(m[f.deliveryDate]) },
        { label: 'Delivery time',     value: fmtDateTime(m[f.deliveryTime]) },
        { label: 'Delivery location', value: m[f.deliveryLocation] },
        { label: 'Delivery notes',    value: m[f.deliveryNotes], multi: true },
        { label: 'Assigned to',       value: m[f.assignTo] },
      ]} />

      <Section title="Location" rows={[
        { label: 'Address', value: m[f.address] },
        { label: 'County',  value: m[f.county] },
        { label: 'Region',  value: m[f.region] },
      ]} />

      <Section title="Audit" rows={[
        { label: 'Created', value: fmtDateTime(m[f.creationDate]) },
        { label: 'Creator', value: m[f.creator] },
        { label: 'Edited',  value: fmtDateTime(m[f.editDate]) },
        { label: 'Editor',  value: m[f.editor] },
      ]} />
    </div>
  );
}

// ─── Followups tab body ──────────────────────────────────────────────
// Renders an ordered list (most recent first) of followup entries. Each
// entry shows a timestamp + author header, the followup body text, and
// a small contact footer.
function FollowupsTabBody({
  state, canEdit, resource,
  showComposer, onOpenComposer, onCancelComposer, onSubmitted,
}) {
  const composer = showComposer && canEdit && resource ? (
    <FollowupComposer
      resource={resource}
      onCancel={onCancelComposer}
      onSubmitted={onSubmitted}
    />
  ) : null;

  const addBtn = canEdit && !showComposer ? (
    <button type="button" className="btn btn-primary btn-sm followup-add" onClick={onOpenComposer}>
      + Add followup
    </button>
  ) : null;

  if (state.status === 'idle' || state.status === 'loading') {
    return (
      <div className="modal-body">
        {addBtn}
        {composer}
        <div className="modal-loading">
          <div className="spinner" />
          <p className="muted small">Loading followups…</p>
        </div>
      </div>
    );
  }
  if (state.status === 'error') {
    return (
      <div className="modal-body">
        {addBtn}
        {composer}
        <div className="empty-banner">
          <strong>Couldn't load followups.</strong>
          <div className="muted small">{state.error}</div>
        </div>
      </div>
    );
  }
  if (state.status === 'empty' || state.data.length === 0) {
    return (
      <div className="modal-body">
        {addBtn}
        {composer}
        <div className="picker-empty">
          <strong>No followups yet.</strong>
          <p className="muted small">
            No followup entries are tied to this request number and
            mission yet. Use the Add button above to enter one.
          </p>
        </div>
      </div>
    );
  }

  const f = FOLLOWUP_SERVICE.fields;
  return (
    <div className="modal-body">
      <div className="followups-header">
        <div className="muted small followups-count">
          {state.data.length} followup{state.data.length === 1 ? '' : 's'}
        </div>
        {addBtn}
      </div>
      {composer}
      <ol className="followups-list">
        {state.data.map((fu) => {
          const when     = fmtDateTime(fu[f.entryDate]);
          const author   = fu[f.username] || fu[f.updatedBy] || '—';
          const position = fu[f.positionName];
          const agency   = fu[f.updatingAgency];
          const phone    = fu[f.phone];
          const email    = fu[f.email];
          const body     = fu[f.data];
          return (
            <li key={fu[f.objectId]} className="followup-card">
              <header className="followup-head">
                <div className="followup-author">
                  <div className="followup-name-line">
                    <strong>{author}</strong>
                    {position && (
                      <>
                        <span className="dot muted">·</span>
                        <span className="muted small">{position}</span>
                      </>
                    )}
                  </div>
                  {when && <span className="muted small">{when}</span>}
                </div>
              </header>
              {body && <div className="followup-body">{String(body)}</div>}
              {(email || phone) && (
                <div className="followup-contact muted small">
                  {email && (
                    <a href={`mailto:${email}`}>{email}</a>
                  )}
                  {email && phone && <span className="dot">·</span>}
                  {phone && (
                    <a href={`tel:${String(phone).replace(/[^+\d]/g, '')}`}>
                      {phone}
                    </a>
                  )}
                </div>
              )}
            </li>
          );
        })}
      </ol>
    </div>
  );
}

// ─── Add-followup composer ──────────────────────────────────────────
function FollowupComposer({ resource, onCancel, onSubmitted }) {
  const f = FOLLOWUP_SERVICE.fields;
  const [author, setAuthor] = useState(() => loadAuthorPrefs());
  const [text,   setText]   = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [error,      setError]      = useState('');

  const update = (patch) => setAuthor((prev) => ({ ...prev, ...patch }));

  const onSubmit = async (e) => {
    e.preventDefault();
    if (!text.trim()) {
      setError('Followup text is required.');
      return;
    }
    if (!author.username.trim()) {
      setError('Your name is required.');
      return;
    }
    setError('');
    setSubmitting(true);
    try {
      const attrs = {
        [f.requestNumber]:  String(resource.request_number_rpt || ''),
        [f.mission]:        String(resource.mission_id_rpt || ''),
        [f.entryDate]:      new Date().toISOString(),
        [f.data]:           text.trim(),
        [f.username]:       author.username.trim(),
        [f.positionName]:   author.position.trim(),
        [f.updatingAgency]: author.agency.trim(),
        [f.phone]:          author.phone.trim(),
        [f.email]:          author.email.trim(),
        [f.updatedBy]:      author.username.trim(),
      };
      await addFollowup(attrs);
      saveAuthorPrefs(author);
      setText('');
      onSubmitted && onSubmitted();
    } catch (ex) {
      setError(ex.message || 'Failed to save followup.');
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <form className="followup-composer" onSubmit={onSubmit}>
      <label className="composer-field composer-textarea">
        <span className="muted small">Followup note</span>
        <textarea
          value={text}
          onChange={(e) => setText(e.target.value)}
          rows={4}
          placeholder="What's the update?"
          maxLength={5000}
          autoFocus
        />
      </label>

      <div className="composer-grid">
        <label className="composer-field">
          <span className="muted small">Your name</span>
          <input type="text" value={author.username} onChange={(e) => update({ username: e.target.value })} />
        </label>
        <label className="composer-field">
          <span className="muted small">Position</span>
          <input type="text" value={author.position} onChange={(e) => update({ position: e.target.value })} />
        </label>
        <label className="composer-field">
          <span className="muted small">Agency</span>
          <input type="text" value={author.agency} onChange={(e) => update({ agency: e.target.value })} />
        </label>
        <label className="composer-field">
          <span className="muted small">Email</span>
          <input type="email" value={author.email} onChange={(e) => update({ email: e.target.value })} />
        </label>
        <label className="composer-field">
          <span className="muted small">Phone</span>
          <input type="tel" value={author.phone} onChange={(e) => update({ phone: e.target.value })} />
        </label>
      </div>

      {error && <div className="composer-error">{error}</div>}

      <div className="composer-actions">
        <button type="button" className="btn btn-ghost" onClick={onCancel} disabled={submitting}>
          Cancel
        </button>
        <button type="submit" className="btn btn-primary" disabled={submitting}>
          {submitting ? 'Saving…' : 'Save followup'}
        </button>
      </div>
    </form>
  );
}
