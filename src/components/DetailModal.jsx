import { useEffect, useState } from 'react';
import { FIELDS, MISSION_TYPES, MCC_SERVICE } from '../config.js';
import { fetchMccRequest } from '../service.js';

// Pretty-print a date+time field (epoch ms). Used for fields like
// EditDate / CreationDate / expected_arrival.
function fmtDateTime(v) {
  if (v == null || v === '') return null;
  const n = Number(v);
  if (!Number.isFinite(n) || n <= 0) return null;
  const d = new Date(n);
  if (Number.isNaN(d.getTime())) return null;
  return d.toLocaleString();
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

function Section({ title, rows }) {
  // Editable rows are always shown so users can fill in blanks; static
  // rows are hidden when empty.
  const visible = rows.filter((r) => r.editable || has(r.value));
  if (visible.length === 0) return null;
  return (
    <section className="modal-section">
      <h3>{title}</h3>
      <dl>
        {visible.map((r) =>
          r.editable ? (
            <EditableSelectRow
              key={r.label}
              label={r.label}
              value={r.value}
              options={r.options}
              field={r.field}
              objectId={r.objectId}
              onUpdate={r.onUpdate}
            />
          ) : (
            <div className={`modal-row${r.multi ? ' multi' : ''}`} key={r.label}>
              <dt>{r.label}</dt>
              <dd>{String(r.value)}</dd>
            </div>
          ),
        )}
      </dl>
    </section>
  );
}

function EditableSelectRow({ label, value, options, field, objectId, onUpdate }) {
  const [saving, setSaving] = useState(false);
  const [err,    setErr]    = useState('');

  const handleChange = async (e) => {
    const newVal = e.target.value || null;
    if (!onUpdate) return;
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
          disabled={saving || !onUpdate}
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

export default function DetailModal({ r, onClose, onUpdate }) {
  const [activeTab, setActiveTab] = useState('resource'); // 'resource' | 'mcc'

  // MCC tab state. Cached on the modal instance so switching tabs back
  // and forth doesn't re-fetch.
  const [mccState, setMccState] = useState({ status: 'idle', data: null, error: '' });

  // ESC closes the modal
  useEffect(() => {
    if (!r) return;
    const onKey = (e) => { if (e.key === 'Escape') onClose(); };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [r, onClose]);

  // Reset tab + MCC cache whenever a different row is shown.
  useEffect(() => {
    setActiveTab('resource');
    setMccState({ status: 'idle', data: null, error: '' });
  }, [r && r.objectid]);

  // Lazy-load the MCC record the first time the user opens the tab.
  useEffect(() => {
    if (!r) return;
    if (activeTab !== 'mcc') return;
    if (mccState.status !== 'idle') return;
    let cancelled = false;
    setMccState({ status: 'loading', data: null, error: '' });
    fetchMccRequest({
      requestNumber: r.request_number_rpt,
      missionId:     r.mission_id_rpt,
    })
      .then((data) => {
        if (cancelled) return;
        setMccState({ status: data ? 'loaded' : 'empty', data: data || null, error: '' });
      })
      .catch((err) => {
        if (cancelled) return;
        setMccState({ status: 'error', data: null, error: err.message || String(err) });
      });
    return () => { cancelled = true; };
  }, [activeTab, r, mccState.status]);

  if (!r) return null;

  const reqNum = r.request_number_rpt;
  const title  = reqNum ? `Request #${reqNum}` : `OBJECTID ${r.objectid}`;

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
        </div>

        {activeTab === 'mcc' ? (
          <MccTabBody state={mccState} />
        ) : (
        <div className="modal-body">
          <Section title="Resource" rows={[
            { label: 'Kind',            value: r.resource_kind },
            { label: 'Type',            value: r.resource_type },
            { label: 'Description',     value: r.resource_main },
            { label: 'Equipment',       value: r.equipment },
            { label: 'Equipment type',  value: r.equipment_type },
            { label: 'Equipment count', value: r.equipment_count },
            { label: 'Team kind',       value: r.team_kind },
            { label: 'Personnel',       value: r.personnel_count },
            { label: 'Identifier',      value: r.identifier },
            { label: 'Tag #',           value: r.tag_number },
            { label: 'Item',            value: r.item },
            { label: 'Quantity',        value: r.qty_item },
            { label: 'Make',            value: r.make },
            { label: 'Serial',          value: r.serial },
          ]} />

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
            { label: 'Created',  value: fmtDateTime(r.CreationDate) },
            { label: 'Creator',  value: r.Creator },
            { label: 'Edited',   value: fmtDateTime(r.EditDate) },
            { label: 'Editor',   value: r.Editor },
            { label: 'OBJECTID', value: r.objectid },
            { label: 'GlobalID', value: r.globalid },
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
        { label: 'Created',  value: fmtDateTime(m[f.creationDate]) },
        { label: 'Creator',  value: m[f.creator] },
        { label: 'Edited',   value: fmtDateTime(m[f.editDate]) },
        { label: 'Editor',   value: m[f.editor] },
        { label: 'ObjectID', value: m[f.objectId] },
        { label: 'GlobalID', value: m[f.globalId] },
      ]} />
    </div>
  );
}
