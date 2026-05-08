import { useEffect, useState } from 'react';
import { FIELDS, MISSION_TYPES } from '../config.js';

// Pretty-print an epoch ms field. Returns null if missing/invalid.
function fmtDate(v) {
  if (v == null || v === '') return null;
  const n = Number(v);
  if (!Number.isFinite(n) || n <= 0) return null;
  const d = new Date(n);
  if (Number.isNaN(d.getTime())) return null;
  return d.toLocaleString();
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
  // If the current value isn't in our options, show it anyway so the
  // user sees what's there and can pick a new one.
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
          <option value="">— Select —</option>
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
  // ESC closes the modal
  useEffect(() => {
    if (!r) return;
    const onKey = (e) => { if (e.key === 'Escape') onClose(); };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [r, onClose]);

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
            { label: 'Expected arrival',   value: fmtDate(r.expected_arrival) },
            { label: 'Demobilization',     value: fmtDate(r.item_demobilization) },
            { label: 'Days deployed',      value: r.days_deployed },
            { label: 'Expected days',      value: r.expected_days_deployed },
          ]} />

          <Section title="Notes" rows={[
            { label: 'RESL note', value: r.resl_note, multi: true },
            { label: 'Notes',     value: r.note_rpt,  multi: true },
          ]} />

          <Section title="Audit" rows={[
            { label: 'Created',  value: fmtDate(r.CreationDate) },
            { label: 'Creator',  value: r.Creator },
            { label: 'Edited',   value: fmtDate(r.EditDate) },
            { label: 'Editor',   value: r.Editor },
            { label: 'OBJECTID', value: r.objectid },
            { label: 'GlobalID', value: r.globalid },
          ]} />
        </div>
      </div>
    </div>
  );
}
