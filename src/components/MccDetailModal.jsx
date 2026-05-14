import { useCallback, useEffect, useRef, useState } from 'react';
import { MCC_SERVICE, FIELDS, buildResourceSurveyUrl } from '../config.js';
import { fetchFollowups } from '../service.js';
import { FollowupsTabBody } from './DetailModal.jsx';

function fmtDateTime(v) {
  if (v == null || v === '') return null;
  const n = Number(v);
  if (Number.isFinite(n) && n > 0) {
    const d = new Date(n);
    if (!Number.isNaN(d.getTime())) return d.toLocaleString();
  }
  const d2 = new Date(String(v));
  if (!Number.isNaN(d2.getTime())) return d2.toLocaleString();
  return String(v);
}
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

// Survey123 sometimes leaves the assigned-to field at its placeholder
// value ("(select)" or similar). Treat that as Unassigned for display.
function assignToDisplay(v) {
  if (v == null) return null;
  const s = String(v).trim();
  if (!s) return null;
  if (/^\(?\s*select\s*\)?$/i.test(s)) return 'Unassigned';
  return s;
}

function Section({ title, rows }) {
  const visible = rows.filter((r) => has(r.value));
  if (visible.length === 0) return null;
  return (
    <section className="modal-section">
      <h3>{title}</h3>
      <dl>
        {visible.map((r) => (
          <div className={`modal-row${r.multi ? ' multi' : ''}`} key={r.label}>
            <dt>{r.label}</dt>
            <dd>{String(r.value)}</dd>
          </div>
        ))}
      </dl>
    </section>
  );
}

// Normalize for comparison (same shape as Board.jsx's `n` helper).
function n(s) {
  return String(s ?? '').trim().toLowerCase().replace(/\s+/g, ' ');
}

// Find all deployment resources that fulfill this MCC.
function matchingDeployments(mcc, deployments) {
  if (!mcc) return [];
  const f = MCC_SERVICE.fields;
  const reqNum  = n(mcc[f.mccNumber]);
  const mission = n(mcc[f.incidentId]);
  if (!reqNum) return [];
  return deployments.filter((d) =>
    n(d.request_number_rpt) === reqNum &&
    (!mission || n(d.mission_id_rpt) === mission),
  );
}

export default function MccDetailModal({ mcc, deployments = [], readOnly = false, onClose, onShowDeployment }) {
  const [activeTab, setActiveTab] = useState('details'); // 'details' | 'deployments' | 'followups'

  // Followups tab state (mirrors DetailModal.jsx's followups handling).
  const [fuState, setFuState]           = useState({ status: 'idle', data: [], error: '' });
  const [showComposer, setShowComposer] = useState(false);
  const fuFetchedFor                    = useRef(null);
  const fuTriggeredFor                  = useRef(null);

  // ESC closes
  useEffect(() => {
    if (!mcc) return;
    const onKey = (e) => { if (e.key === 'Escape') onClose(); };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [mcc, onClose]);

  // Reset tabs + followups cache when a different MCC is opened.
  useEffect(() => {
    setActiveTab('details');
    setFuState({ status: 'idle', data: [], error: '' });
    setShowComposer(false);
    fuFetchedFor.current = null;
    fuTriggeredFor.current = null;
  }, [mcc && mcc[MCC_SERVICE.fields.objectId]]);

  // Lazy-fetch followups when the tab is opened.
  const reloadFollowups = useCallback(() => {
    if (!mcc) return;
    const token = Symbol();
    fuFetchedFor.current = token;
    setFuState({ status: 'loading', data: [], error: '' });
    fetchFollowups({
      requestNumber: mcc[MCC_SERVICE.fields.mccNumber],
      missionId:     mcc[MCC_SERVICE.fields.incidentId],
    })
      .then((data) => {
        if (fuFetchedFor.current !== token) return;
        setFuState({ status: data.length ? 'loaded' : 'empty', data, error: '' });
      })
      .catch((err) => {
        if (fuFetchedFor.current !== token) return;
        setFuState({ status: 'error', data: [], error: err.message || String(err) });
      });
  }, [mcc]);

  useEffect(() => {
    if (!mcc) return;
    if (activeTab !== 'followups') return;
    const oid = mcc[MCC_SERVICE.fields.objectId];
    if (fuTriggeredFor.current === oid) return;
    fuTriggeredFor.current = oid;
    reloadFollowups();
  }, [activeTab, mcc, reloadFollowups]);

  if (!mcc) return null;

  const f = MCC_SERVICE.fields;
  const mccNum = mcc[f.mccNumber];
  const title  = mccNum ? `MCC #${mccNum}` : 'MCC request';
  const deployList = matchingDeployments(mcc, deployments);

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
              {mcc[f.status] || '—'}{mcc[f.county] ? ` · ${mcc[f.county]} County` : ''}
            </div>
            <h2>{title}</h2>
          </div>
          <div className="modal-header-actions">
            {!readOnly && (
              <a
                className="btn btn-primary btn-sm"
                href={buildResourceSurveyUrl(mcc)}
                target="_blank"
                rel="noopener noreferrer"
                title="Open the RESL deployment Survey123 form pre-filled from this MCC"
              >
                + Create deployment
              </a>
            )}
            <button className="modal-close" onClick={onClose} aria-label="Close">×</button>
          </div>
        </header>

        <div className="modal-tabs" role="tablist">
          <button
            type="button"
            role="tab"
            aria-selected={activeTab === 'details'}
            className={`modal-tab${activeTab === 'details' ? ' is-active' : ''}`}
            onClick={() => setActiveTab('details')}
          >
            MCC Details
          </button>
          <button
            type="button"
            role="tab"
            aria-selected={activeTab === 'deployments'}
            className={`modal-tab${activeTab === 'deployments' ? ' is-active' : ''}`}
            onClick={() => setActiveTab('deployments')}
          >
            Deployments {deployList.length > 0 && <span className="tab-count">{deployList.length}</span>}
          </button>
          <button
            type="button"
            role="tab"
            aria-selected={activeTab === 'followups'}
            className={`modal-tab${activeTab === 'followups' ? ' is-active' : ''}`}
            onClick={() => setActiveTab('followups')}
            title="Follow-up notes tied to this MCC request"
          >
            Followups {fuState.data.length > 0 && <span className="tab-count">{fuState.data.length}</span>}
          </button>
        </div>

        {activeTab === 'deployments' ? (
          <DeploymentsBody deployments={deployList} onShowDeployment={onShowDeployment} />
        ) : activeTab === 'followups' ? (
          <FollowupsTabBody
            state={fuState}
            canEdit={!readOnly}
            resource={{
              // FollowupComposer reads these two keys when building the
              // payload — map the MCC fields onto them so the followup
              // is tied back to this MCC + mission.
              request_number_rpt: mcc[f.mccNumber],
              mission_id_rpt:     mcc[f.incidentId],
            }}
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
            <Section title="Request" rows={[
              { label: 'MCC #',     value: mcc[f.mccNumber] },
              { label: 'Subject',   value: mcc[f.subject] },
              { label: 'Type',      value: mcc[f.type] },
              { label: 'Priority',  value: mcc[f.priority] },
              { label: 'Status',    value: mcc[f.status] },
              { label: 'Lifeline',  value: mcc[f.lifeline] },
              { label: 'Feeding',   value: mcc[f.feeding] },
            ]} />

            <Section title="Description" rows={[
              { label: 'Description', value: mcc[f.description], multi: true },
            ]} />

            <Section title="Originator" rows={[
              { label: 'Originator',  value: mcc[f.originator] },
              { label: 'Position',    value: mcc[f.mccPosition] },
              { label: 'MCC created', value: fmtDateTime(mcc[f.mccCreated]) },
              { label: 'Entry date',  value: fmtDateTime(mcc[f.entryDate]) },
            ]} />

            <Section title="Point of contact" rows={[
              { label: 'Name',       value: mcc[f.pocName] },
              { label: 'Title',      value: mcc[f.pocTitle] },
              { label: 'Phone',      value: mcc[f.pocPhone] },
              { label: 'Subscriber', value: mcc[f.subscriberName] },
            ]} />

            <Section title="Delivery" rows={[
              { label: 'Delivery date',     value: fmtDate(mcc[f.deliveryDate]) },
              { label: 'Delivery time',     value: fmtDateTime(mcc[f.deliveryTime]) },
              { label: 'Delivery location', value: mcc[f.deliveryLocation] },
              { label: 'Delivery notes',    value: mcc[f.deliveryNotes], multi: true },
              { label: 'Assigned to',       value: assignToDisplay(mcc[f.assignTo]) },
            ]} />

            <Section title="Location" rows={[
              { label: 'Address', value: mcc[f.address] },
              { label: 'County',  value: mcc[f.county] },
              { label: 'Region',  value: mcc[f.region] },
            ]} />

            <Section title="Audit" rows={[
              { label: 'Created', value: fmtDateTime(mcc[f.creationDate]) },
              { label: 'Creator', value: mcc[f.creator] },
              { label: 'Edited',  value: fmtDateTime(mcc[f.editDate]) },
              { label: 'Editor',  value: mcc[f.editor] },
            ]} />
          </div>
        )}
      </div>
    </div>
  );
}

function DeploymentsBody({ deployments, onShowDeployment }) {
  if (!deployments.length) {
    return (
      <div className="modal-body">
        <div className="picker-empty">
          <strong>No deployments yet.</strong>
          <p className="muted small">
            No resources have been assigned to this MCC request yet.
          </p>
        </div>
      </div>
    );
  }
  return (
    <div className="modal-body">
      <div className="muted small followups-count">
        {deployments.length} deployment{deployments.length === 1 ? '' : 's'}
      </div>
      <ol className="deployments-list">
        {deployments.map((d) => {
          const reqNum = d[FIELDS.requestNumber];
          const status = d[FIELDS.status];
          const kind   = d[FIELDS.kind];
          const equip  = d.equipment || d.equipment_type;
          const team   = d.team_kind || d.identifier;
          const equipQ = d.equipment_count;
          const persQ  = d.personnel_count;
          const summary = kind && kind.toLowerCase().includes('equip')
            ? (equipQ ? `${equipQ} × ${equip || 'equipment'}` : (equip || 'Equipment'))
            : (persQ && persQ > 1 ? `${persQ} personnel · ${team || ''}` : (team || 'Team'));
          return (
            <li key={d[FIELDS.objectId]}>
              <button
                type="button"
                className="deployment-row"
                onClick={() => onShowDeployment && onShowDeployment(d)}
              >
                <div className="deployment-row-head">
                  <strong>{reqNum ? `#${reqNum}` : 'Request'}</strong>
                  {status && <span className="card-chip">{status}</span>}
                </div>
                <div className="muted small">{summary}</div>
                {d.entity_rpt && <div className="muted small">{d.entity_rpt}</div>}
              </button>
            </li>
          );
        })}
      </ol>
    </div>
  );
}
