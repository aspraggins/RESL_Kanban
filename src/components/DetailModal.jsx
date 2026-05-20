import { useCallback, useEffect, useRef, useState } from 'react';
import { FIELDS, MISSION_TYPES, TEAM_KINDS, MCC_SERVICE, FOLLOWUP_SERVICE, HISTORY_SERVICE, labelFor } from '../config.js';
import { fetchMccRequest, fetchFollowups, addFollowup, fetchHistory, geocodeAddress, suggestAddresses } from '../service.js';
import { getToken } from '../auth.js';

const FOLLOWUP_AUTHOR_KEY = 'resl_kanban_followup_author_v1';

function loadAuthorPrefs() {
  const tok = getToken();
  const tokenName = tok?.fullName || tok?.username || '';
  // Defaults — also guarantees every expected key is a string so the
  // composer's `.trim()` calls never hit `undefined`.
  const defaults = {
    username: tokenName,
    position: '',
    agency:   '',
    email:    tok?.email || '',
  };
  try {
    const raw = localStorage.getItem(FOLLOWUP_AUTHOR_KEY);
    if (raw) {
      const saved = JSON.parse(raw);
      const merged = { ...defaults, ...saved };
      // If the previously-saved name looks like an AGOL username (the
      // old default before we started capturing fullName), upgrade it.
      if (merged.username && tok?.fullName &&
          merged.username === tok?.username && merged.username !== tok.fullName) {
        merged.username = tok.fullName;
      }
      // Pull email from token if the saved record has none.
      if (!merged.email && tok?.email) merged.email = tok.email;
      return merged;
    }
  } catch { /* ignore */ }
  return defaults;
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

// AGOL date-only fields are stored as UTC midnight epoch ms. These two
// helpers convert between that representation and the `YYYY-MM-DD`
// string format <input type="date"> expects.
function epochToInputDate(v) {
  if (v == null || v === '') return '';
  const n = Number(v);
  if (!Number.isFinite(n) || n <= 0) return '';
  const d = new Date(n);
  if (Number.isNaN(d.getTime())) return '';
  const y = d.getUTCFullYear();
  const m = String(d.getUTCMonth() + 1).padStart(2, '0');
  const day = String(d.getUTCDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}
function inputDateToEpoch(s) {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(s || '');
  if (!m) return null;
  return Date.UTC(Number(m[1]), Number(m[2]) - 1, Number(m[3]));
}

// Mirror Survey123's `days_deployed` calc:
//   int((decimal-date-time(item_demobilization) - decimal-date-time(item_mobilization)))
// Returns null if either date is missing.
function recalcDaysDeployed(mob, demob) {
  const m = Number(mob);
  const d = Number(demob);
  if (!Number.isFinite(m) || !Number.isFinite(d)) return null;
  return Math.floor((d - m) / 86_400_000);
}

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
          if (r.type === 'text') {
            return (
              <EditableTextRow
                key={r.label}
                label={r.label}
                value={r.value}
                field={r.field}
                objectId={r.objectId}
                onUpdate={r.onUpdate}
              />
            );
          }
          if (r.type === 'date') {
            return (
              <EditableDateRow
                key={r.label}
                label={r.label}
                value={r.value}
                field={r.field}
                objectId={r.objectId}
                onUpdate={r.onUpdate}
              />
            );
          }
          if (r.type === 'address') {
            return (
              <EditableAddressRow
                key={r.label}
                label={r.label}
                value={r.value}
                field={r.field}
                geocodedField={r.geocodedField}
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

// Editable free-text input. Saves on blur or Enter. Renders as plain
// text when onUpdate isn't provided (read-only mode).
function EditableTextRow({ label, value, field, objectId, onUpdate }) {
  const initial = value == null ? '' : String(value);
  const [local,  setLocal]  = useState(initial);
  const [saving, setSaving] = useState(false);
  const [err,    setErr]    = useState('');

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
    const newVal  = trimmed === '' ? null : trimmed;
    // No-op when unchanged
    if ((newVal == null ? '' : newVal) === initial) {
      setErr('');
      return;
    }
    setErr('');
    setSaving(true);
    try {
      await onUpdate(objectId, { [field]: newVal });
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
          className="modal-edit-input modal-edit-input--text"
          type="text"
          value={local}
          onChange={(e) => setLocal(e.target.value)}
          onBlur={commit}
          onKeyDown={(e) => {
            if (e.key === 'Enter') { e.preventDefault(); e.currentTarget.blur(); }
            if (e.key === 'Escape') { setLocal(initial); setErr(''); e.currentTarget.blur(); }
          }}
          disabled={saving}
          placeholder="Type a description…"
        />
        {saving && <span className="muted small modal-edit-status">Saving…</span>}
        {!saving && err && <span className="error-text small modal-edit-status">{err}</span>}
      </dd>
    </div>
  );
}

// Editable date-only input. AGOL stores date fields as UTC midnight
// epoch ms; we convert to/from `YYYY-MM-DD` for the native picker.
function EditableDateRow({ label, value, field, objectId, onUpdate }) {
  const initial = epochToInputDate(value);
  const [local,  setLocal]  = useState(initial);
  const [saving, setSaving] = useState(false);
  const [err,    setErr]    = useState('');

  useEffect(() => { setLocal(initial); }, [initial]);

  if (!onUpdate) {
    if (!has(value)) return null;
    return (
      <div className="modal-row">
        <dt>{label}</dt>
        <dd>{fmtDate(value) || String(value)}</dd>
      </div>
    );
  }

  const commit = async () => {
    const newEpoch = local ? inputDateToEpoch(local) : null;
    const oldEpoch = initial ? inputDateToEpoch(initial) : null;
    if (newEpoch === oldEpoch) { setErr(''); return; }
    if (local && newEpoch == null) {
      setErr('Invalid date.');
      return;
    }
    setErr('');
    setSaving(true);
    try {
      await onUpdate(objectId, { [field]: newEpoch });
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
          type="date"
          className="modal-edit-input modal-edit-input--date"
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

// Editable address input with typeahead. On commit (clicking a
// suggestion, pressing Enter, or blurring with a changed value) the
// ArcGIS World Geocoder resolves the address and writes five things in
// one applyEdits:
//   • user_input_txt_rpt — the user-typed string, verbatim (`field`)
//   • address_geo_rpt    — geocoder Match_addr        (`geocodedField`)
//   • county_rpt         — derived county (TN-only)
//   • region_rpt         — derived TEMA region (TN-only)
//   • geometry           — the record's point on the map
// Non-TN matches still save user input + matched + geometry but leave
// county/region untouched (with a small warning) so existing values
// aren't silently overwritten.
function EditableAddressRow({ label, value, field, geocodedField, objectId, onUpdate }) {
  const initial = value == null ? '' : String(value);
  const [local,  setLocal]  = useState(initial);
  const [saving, setSaving] = useState(false);
  const [err,    setErr]    = useState('');
  const [info,   setInfo]   = useState('');

  // Typeahead state
  const [suggestions, setSuggestions] = useState([]);
  const [suggestOpen, setSuggestOpen] = useState(false);
  const [highlight,   setHighlight]   = useState(-1);
  const inputRef = useRef(null);
  // The user just picked a suggestion (mousedown selected magicKey) —
  // skip the onBlur free-text commit so we don't double-geocode.
  const pickedRef = useRef(null);
  // Track in-flight suggest requests so an older response can't
  // overwrite a newer one out of order.
  const abortRef = useRef(null);

  useEffect(() => { setLocal(initial); }, [initial]);

  // Debounced suggest. Fires 250ms after the user stops typing, only
  // when the input has at least 3 characters and the value isn't the
  // current saved address (so reopening the modal doesn't pop the
  // dropdown).
  useEffect(() => {
    if (!onUpdate) return;
    const text = local.trim();
    if (text.length < 3 || text === initial) {
      setSuggestions([]); setSuggestOpen(false); setHighlight(-1);
      return;
    }
    if (abortRef.current) abortRef.current.abort();
    const ac = new AbortController();
    abortRef.current = ac;
    const t = setTimeout(() => {
      suggestAddresses(text, { signal: ac.signal })
        .then((list) => {
          if (ac.signal.aborted) return;
          setSuggestions(list);
          setSuggestOpen(list.length > 0);
          setHighlight(list.length > 0 ? 0 : -1);
        })
        .catch((ex) => {
          if (ex.name === 'AbortError') return;
          // Suggest is best-effort — log but don't surface to the user.
          console.warn('[RESL-Kanban] suggest failed:', ex);
          setSuggestions([]); setSuggestOpen(false);
        });
    }, 250);
    return () => { clearTimeout(t); ac.abort(); };
  }, [local, initial, onUpdate]);

  if (!onUpdate) {
    if (!has(value)) return null;
    return (
      <div className="modal-row">
        <dt>{label}</dt>
        <dd>{String(value)}</dd>
      </div>
    );
  }

  // Run the geocoder + write. `displayText` is what we save into the
  // user-typed field; `magicKey` (when present) makes the geocode
  // resolve to the exact suggestion the user picked.
  const runGeocodeAndSave = async (displayText, magicKey) => {
    setErr(''); setInfo('');
    setSuggestOpen(false);
    setSaving(true);
    try {
      const match = await geocodeAddress(displayText, { magicKey });
      if (!match) throw new Error('No address match found.');

      const savedText = displayText || match.matchedAddress;
      const partial = { [field]: savedText };
      if (geocodedField) partial[geocodedField] = match.matchedAddress;
      if (match.isTn) {
        partial[FIELDS.county] = match.county || null;
        partial[FIELDS.region] = match.region || null;
        setInfo(`${match.county} County · ${match.region} Region`);
      } else {
        setInfo('Outside Tennessee — county/region left as is.');
      }

      const geometry = (match.lng != null && match.lat != null)
        ? { x: Number(match.lng), y: Number(match.lat),
            spatialReference: { wkid: 4326 } }
        : null;

      await onUpdate(objectId, partial, geometry);
      setLocal(savedText);
    } catch (ex) {
      setErr(ex.message || 'Geocode failed');
      setLocal(initial);
    } finally {
      setSaving(false);
    }
  };

  const pickSuggestion = (s) => {
    if (!s) return;
    pickedRef.current = s.magicKey || true;
    setLocal(s.text);
    runGeocodeAndSave(s.text, s.magicKey);
  };

  const commitFreeText = async () => {
    const trimmed = local.trim();
    // Skip if the user just picked a suggestion (handled separately).
    if (pickedRef.current) { pickedRef.current = null; return; }
    if (trimmed === initial) { setErr(''); setInfo(''); return; }
    if (trimmed === '') {
      // Clear path — drop both user-input and the geocoded field.
      setSaving(true);
      try {
        const clearPartial = { [field]: null };
        if (geocodedField) clearPartial[geocodedField] = null;
        await onUpdate(objectId, clearPartial);
      } catch (ex) {
        setErr(ex.message || 'Save failed');
        setLocal(initial);
      } finally { setSaving(false); }
      return;
    }
    await runGeocodeAndSave(trimmed, null);
  };

  const onKeyDown = (e) => {
    if (suggestOpen && suggestions.length > 0) {
      if (e.key === 'ArrowDown') {
        e.preventDefault();
        setHighlight((h) => (h + 1) % suggestions.length);
        return;
      }
      if (e.key === 'ArrowUp') {
        e.preventDefault();
        setHighlight((h) => (h <= 0 ? suggestions.length - 1 : h - 1));
        return;
      }
      if (e.key === 'Enter') {
        e.preventDefault();
        const pick = suggestions[highlight >= 0 ? highlight : 0];
        pickSuggestion(pick);
        return;
      }
    }
    if (e.key === 'Enter') {
      e.preventDefault();
      e.currentTarget.blur();
      return;
    }
    if (e.key === 'Escape') {
      setLocal(initial);
      setErr(''); setInfo('');
      setSuggestOpen(false);
      e.currentTarget.blur();
    }
  };

  return (
    <div className="modal-row editable">
      <dt>{label}</dt>
      <dd>
        <div className="address-autocomplete">
          <input
            ref={inputRef}
            className="modal-edit-input modal-edit-input--text"
            type="text"
            value={local}
            onChange={(e) => {
              setLocal(e.target.value);
              setInfo(''); setErr('');
              pickedRef.current = null;
            }}
            onFocus={() => {
              if (suggestions.length > 0 && local.trim().length >= 3 && local !== initial) {
                setSuggestOpen(true);
              }
            }}
            onBlur={commitFreeText}
            onKeyDown={onKeyDown}
            disabled={saving}
            placeholder="Type an address…"
            autoComplete="off"
          />
          {suggestOpen && suggestions.length > 0 && (
            <ul className="address-suggestions" role="listbox">
              {suggestions.map((s, i) => (
                <li
                  key={s.magicKey || s.text}
                  role="option"
                  aria-selected={i === highlight}
                  className={`address-suggestion${i === highlight ? ' is-highlight' : ''}`}
                  // mousedown beats blur, so the input keeps focus
                  // long enough for us to handle the pick.
                  onMouseDown={(e) => { e.preventDefault(); pickSuggestion(s); }}
                  onMouseEnter={() => setHighlight(i)}
                >
                  {s.text}
                </li>
              ))}
            </ul>
          )}
        </div>
        {saving && <span className="muted small modal-edit-status">Geocoding…</span>}
        {!saving && err && <span className="error-text small modal-edit-status">{err}</span>}
        {!saving && !err && info && <span className="muted small modal-edit-status">{info}</span>}
      </dd>
    </div>
  );
}

export default function DetailModal({ r, followupCount = 0, onClose, onUpdate }) {
  const [activeTab, setActiveTab] = useState('resource'); // 'resource' | 'mcc' | 'followups' | 'history'

  // MCC tab state (single record).
  const [mccState, setMccState] = useState({ status: 'idle', data: null, error: '' });
  const mccFetchedFor = useRef(null);

  // Followups tab state (array of records).
  const [fuState, setFuState] = useState({ status: 'idle', data: [], error: '' });
  const fuFetchedFor = useRef(null);
  const fuTriggeredFor = useRef(null);
  const [showComposer, setShowComposer] = useState(false);

  // History tab state (array of audit-log records).
  const [histState, setHistState] = useState({ status: 'idle', data: [], error: '' });
  const histFetchedFor = useRef(null);

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
    setHistState({ status: 'idle', data: [], error: '' });
    setShowComposer(false);
    mccFetchedFor.current = null;
    fuFetchedFor.current = null;
    fuTriggeredFor.current = null;
    histFetchedFor.current = null;
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

  // Lazy-load the audit history the first time the user opens the
  // History tab for this row. Joined by GlobalID — falls back to
  // showing an explanatory empty state if the row predates the audit
  // log or doesn't have a GlobalID.
  useEffect(() => {
    if (!r) return;
    if (activeTab !== 'history') return;
    const myToken = r.objectid;
    if (histFetchedFor.current === myToken) return;
    histFetchedFor.current = myToken;

    const gid = r[FIELDS.globalId];
    if (!gid) {
      setHistState({ status: 'empty', data: [], error: '' });
      return;
    }

    setHistState({ status: 'loading', data: [], error: '' });
    fetchHistory({ globalId: gid })
      .then((data) => {
        if (histFetchedFor.current !== myToken) return;
        setHistState({ status: data.length ? 'loaded' : 'empty', data, error: '' });
      })
      .catch((err) => {
        if (histFetchedFor.current !== myToken) return;
        setHistState({ status: 'error', data: [], error: err.message || String(err) });
      });
  }, [activeTab, r]);

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
            Followups {(() => {
              const n = Math.max(followupCount || 0, fuState.data.length);
              return n > 0 ? <span className="tab-count">{n}</span> : null;
            })()}
          </button>
          <button
            type="button"
            role="tab"
            aria-selected={activeTab === 'history'}
            className={`modal-tab${activeTab === 'history' ? ' is-active' : ''}`}
            onClick={() => setActiveTab('history')}
            title="Edit history for this resource"
          >
            History {histState.data.length > 0
              ? <span className="tab-count">{histState.data.length}</span>
              : null}
          </button>
        </div>

        {activeTab === 'mcc' ? (
          <MccTabBody state={mccState} />
        ) : activeTab === 'history' ? (
          <HistoryTabBody state={histState} />
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
            // Team kind editor — only for Team resources.
            !isEquipment(r) && {
              label: 'Team kind',
              value: r.team_kind,
              editable: true,
              options: TEAM_KINDS,
              field: 'team_kind',
              objectId: r[FIELDS.objectId],
              onUpdate,
            },
            // "Other description" — only when team_kind is Other.
            !isEquipment(r) && String(r.team_kind || '').toLowerCase() === 'other' && {
              label: 'Other description',
              value: r.resource_other,
              editable: true,
              type: 'text',
              field: 'resource_other',
              objectId: r[FIELDS.objectId],
              onUpdate,
            },
            // Personnel count editor — only for Team resources.
            !isEquipment(r) && {
              label: 'Personnel',
              value: r.personnel_count,
              editable: true,
              type: 'number',
              field: 'personnel_count',
              objectId: r[FIELDS.objectId],
              onUpdate,
            },
            // Resource description (calculated in Survey123 from team_kind /
            // resource_other / equipment) — surface it right after the team
            // info where it adds context.
            !isEquipment(r) && {
              label: 'Description',
              value: r.resource_main,
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
            // Address is the only editable field here. On commit, the
            // geocoder writes the typed string to user_input_txt_rpt,
            // the normalized form to address_geo_rpt, derives county +
            // region, and updates the geometry — all in one applyEdits.
            // The rows below refresh automatically.
            {
              label: 'Address',
              value: r[FIELDS.userInputAddress],
              editable: true,
              type: 'address',
              field: FIELDS.userInputAddress,
              geocodedField: FIELDS.address,
              objectId: r[FIELDS.objectId],
              onUpdate,
            },
            // Read-only — the Census-normalized address. Hidden when
            // empty (Section drops static rows with no value).
            { label: 'Geocoded as', value: r[FIELDS.address] },
            { label: 'County',  value: r.county_rpt },
            { label: 'Region',  value: r.region_rpt },
          ]} />

          <Section title="Status & Timing" rows={[
            { label: 'Status',             value: r.item_status },
            // Both dates are editable — and editing either triggers a
            // recalc of `days_deployed` so the derived field stays in
            // sync with Survey123's formula.
            {
              label: 'Mobilization date',
              value: r.item_mobilization,
              editable: true,
              type: 'date',
              field: 'item_mobilization',
              objectId: r[FIELDS.objectId],
              onUpdate: onUpdate
                ? (oid, partial) => {
                    const days = recalcDaysDeployed(partial.item_mobilization, r.item_demobilization);
                    if (days != null) partial.days_deployed = days;
                    return onUpdate(oid, partial);
                  }
                : undefined,
            },
            { label: 'Expected arrival',   value: fmtDateTime(r.expected_arrival) },
            {
              label: 'Demobilization',
              value: r.item_demobilization,
              editable: true,
              type: 'date',
              field: 'item_demobilization',
              objectId: r[FIELDS.objectId],
              onUpdate: onUpdate
                ? (oid, partial) => {
                    const days = recalcDaysDeployed(r.item_mobilization, partial.item_demobilization);
                    if (days != null) partial.days_deployed = days;
                    return onUpdate(oid, partial);
                  }
                : undefined,
            },
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
// Exported so MccDetailModal can reuse the same UI for MCC-side
// followups. Renders an ordered list (most recent first) of followup
// entries. Each entry shows a timestamp + author header, the followup
// body text, and a small contact footer.
export function FollowupsTabBody({
  state, canEdit, resource,
  showComposer, onOpenComposer, onCancelComposer, onSubmitted,
  extras = [],
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
  // Build a unified timeline: real followups + the synthetic
  // creation/last-edit events passed in via `extras`. Sort newest-first
  // so the most recent activity (a followup or an edit) shows on top.
  const timeline = [
    ...state.data.map((fu) => ({
      _kind: 'followup',
      _key:  `fu-${fu[f.objectId]}`,
    _ts: parseTimestamp(
      fu[f.entryDate] ?? fu[f.entryDateAlt]
    ),
      data:  fu,
    })),
    ...extras.map((e, i) => ({
      _kind: 'event',
      _key:  `ev-${e.kind}-${i}`,
      _ts:   e.ts || 0,
      data:  e,
    })),
  ].sort((a, b) => b._ts - a._ts);

  return (
    <div className="modal-body">
      <div className="followups-header">
        <div className="muted small followups-count">
          {state.data.length} followup{state.data.length === 1 ? '' : 's'}
          {extras.length > 0 && (
            <> · {extras.length} event{extras.length === 1 ? '' : 's'}</>
          )}
        </div>
        {addBtn}
      </div>
      {composer}
      <ol className="followups-list">
        {timeline.map((item) =>
          item._kind === 'event'
            ? <EventRow key={item._key} event={item.data} />
            : <FollowupRow key={item._key} fu={item.data} fields={f} />,
        )}
      </ol>
    </div>
  );
}

// Try to parse a timestamp out of a followup's entrydate which may be
// either epoch ms or an ISO string.
function parseTimestamp(v) {
  if (v == null || v === '') return 0;
  const n = Number(v);
  if (Number.isFinite(n) && n > 0) return n;
  const d = new Date(String(v));
  return Number.isNaN(d.getTime()) ? 0 : d.getTime();
}

function FollowupRow({ fu, fields: f }) {
  const when = fmtDateTime(
  fu[f.entryDate] ?? fu[f.entryDateAlt]
);
  const author   = fu[f.updatedBy] || '—';
  const position = fu[f.positionId];
  const agency   = fu[f.updatingAgency];
  const email    = fu[f.email];
  const body     = fu[f.data];
  return (
    <li className="followup-card">
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
          {agency && <span className="muted small">{agency}</span>}
        </div>
      </header>
      {body && <div className="followup-body">{String(body)}</div>}
      {email && (
        <div className="followup-contact muted small">
          <a href={`mailto:${email}`}>{email}</a>
        </div>
      )}
    </li>
  );
}

// ─── History tab body ──────────────────────────────────────────────
// Renders the audit log for one resource, newest first. Each row shows
// the change type (status transition or list of changed fields), the
// author's full name, and a relative timestamp ("2h ago"). The full
// snapshot is in `state.data[i]` for any future drill-in view; for now
// we surface just what changed so the timeline reads fast.
function HistoryTabBody({ state }) {
  if (state.status === 'idle' || state.status === 'loading') {
    return (
      <div className="modal-body">
        <div className="modal-loading">
          <div className="spinner" />
          <p className="muted small">Loading history…</p>
        </div>
      </div>
    );
  }
  if (state.status === 'error') {
    return (
      <div className="modal-body">
        <div className="empty-banner">
          <strong>Couldn't load history.</strong>
          <div className="muted small">{state.error}</div>
        </div>
      </div>
    );
  }
  if (state.status === 'empty' || state.data.length === 0) {
    return (
      <div className="modal-body">
        <div className="picker-empty">
          <strong>No edits yet.</strong>
          <p className="muted small">
            Nothing has been changed on this record through the Kanban app
            yet. Drag the card or save a field edit and the change will
            show up here.
          </p>
        </div>
      </div>
    );
  }

  return (
    <div className="modal-body">
      <div className="followups-header">
        <div className="muted small followups-count">
          {state.data.length} edit{state.data.length === 1 ? '' : 's'}
        </div>
      </div>
      <ol className="followups-list">
        {state.data.map((h, i) => (
          <HistoryRow
            key={h.objectid ?? h.OBJECTID ?? `${h[HISTORY_SERVICE.audit.changeTs]}-${i}`}
            row={h}
            // The list is newest-first, so the "previous" snapshot
            // (i.e. the state of the record before this edit happened)
            // lives at index i+1. Pass it through so the row can show
            // before → after for each changed field.
            previous={state.data[i + 1] || null}
          />
        ))}
      </ol>
    </div>
  );
}

// Format an arbitrary AGOL field value for display in a history diff.
// Heuristics:
//   • null / '' / undefined  → em-dash placeholder
//   • numeric "date-ish" field names → date format
//   • plausible epoch ms (large positive integer) → date+time format
//   • everything else → string (trimmed to a sensible length for the
//     scannable inline display; the full value is in the title attr)
function fmtHistoryValue(fieldName, v) {
  if (v == null || v === '') return '—';
  const lc = String(fieldName).toLowerCase();
  const isDateField =
    lc.includes('date') || lc === 'expected_arrival' ||
    lc === 'item_mobilization' || lc === 'item_demobilization';
  const n = Number(v);
  // Date-like numeric → pretty date.
  if (isDateField && Number.isFinite(n) && n > 1e11) {
    // mobilization/demobilization are stored at UTC midnight; render in
    // UTC so the date matches what the picker showed.
    const d = new Date(n);
    if (!Number.isNaN(d.getTime())) {
      return d.toLocaleDateString(undefined, {
        timeZone: 'UTC', month: 'numeric', day: 'numeric', year: 'numeric',
      });
    }
  }
  // Other plausible epoch ms (e.g. EditDate) — full timestamp.
  if (!isDateField && Number.isFinite(n) && n > 1e12 && /(date|time|ts)$/i.test(fieldName)) {
    const d = new Date(n);
    if (!Number.isNaN(d.getTime())) return d.toLocaleString();
  }
  // Plain string — truncate very long notes so the row stays scannable.
  const s = String(v);
  if (s.length > 80) return s.slice(0, 80) + '…';
  return s;
}

// Build a short context string list from a history row's snapshot —
// what the row is ABOUT, so a reader of the timeline can tell which
// piece of equipment / which team moved status without opening the
// detail modal. Equipment surfaces tag + item + make + model/serial;
// Team surfaces identifier + team_kind. Returns an empty array if no
// useful context is present (kind unknown, no fields populated).
function buildEquipmentContext(row) {
  const kind = String(row.resource_kind || '').toLowerCase();
  const parts = [];
  const push = (label, value) => {
    if (value == null || value === '') return;
    const s = String(value).trim();
    if (!s) return;
    parts.push(label ? `${label} ${s}` : s);
  };
  if (kind === 'equipment') {
    push('Tag #', row.tag_number);
    push('',      row.item);
    push('',      row.make);
    // `serial` holds model on inventory-created deployments per the
    // mapping in createDeploymentFromInventory.
    push('',      row.serial);
  } else if (kind === 'team') {
    push('', row.identifier);
    push('', row.team_kind);
    if (row.personnel_count) push('×', row.personnel_count);
  } else {
    // Unknown kind — still surface anything identifying we have.
    push('Tag #', row.tag_number);
    push('',      row.item || row.identifier);
  }
  return parts;
}

function HistoryRow({ row, previous }) {
  const a = HISTORY_SERVICE.audit;
  const when    = fmtDateTime(row[a.changeTs]);
  const author  = row[a.changedBy] || '—';
  const action  = row[a.action] || 'edit';

  // Status changes have their own dedicated audit columns — use them
  // directly so prev_status / new_status are always populated even for
  // the very first history row (where there's no `previous` to diff
  // against).
  if (action === 'status_change') {
    // Build a short identifying context from the snapshot — tag/item
    // for Equipment, identifier + team_kind for Team — so the reader
    // knows WHICH item moved status without having to drill in.
    const contextParts = buildEquipmentContext(row);
    return (
      <li className="followup-card">
        <header className="followup-head">
          <div className="followup-author">
            <div className="followup-name-line">
              <strong>{author}</strong>
              <span className="dot muted">·</span>
              <span className="muted small">status change</span>
            </div>
            {when && <span className="muted small">{when}</span>}
          </div>
        </header>
        <div className="history-body">
          <span className="history-transition">
            <span className="history-status">{row[a.prevStatus] || '—'}</span>
            <span className="history-arrow muted">→</span>
            <span className="history-status">{row[a.newStatus] || '—'}</span>
          </span>
          {contextParts.length > 0 && (
            <div className="history-context muted small">
              {contextParts.map((p, i) => (
                <span key={i}>
                  {i > 0 && <span className="dot"> · </span>}
                  {p}
                </span>
              ))}
            </div>
          )}
        </div>
      </li>
    );
  }

  // Edit row — render one diff line per changed field.
  // Before-values come from the previous (older) history row's
  // snapshot. If there's no previous row (or that row didn't capture
  // this field), we fall back to em-dash.
  const changed = (row[a.changedFields] || '')
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean);

  return (
    <li className="followup-card">
      <header className="followup-head">
        <div className="followup-author">
          <div className="followup-name-line">
            <strong>{author}</strong>
            <span className="dot muted">·</span>
            <span className="muted small">edit</span>
          </div>
          {when && <span className="muted small">{when}</span>}
        </div>
      </header>
      <div className="history-body">
        {changed.length === 0 ? (
          <span className="muted small">(no fields recorded)</span>
        ) : (
          <ul className="history-diffs">
            {changed.map((fieldName) => {
              const beforeRaw = previous ? previous[fieldName] : undefined;
              const afterRaw  = row[fieldName];
              const before = fmtHistoryValue(fieldName, beforeRaw);
              const after  = fmtHistoryValue(fieldName, afterRaw);
              const fullBefore = beforeRaw == null ? '' : String(beforeRaw);
              const fullAfter  = afterRaw  == null ? '' : String(afterRaw);
              return (
                <li key={fieldName} className="history-diff">
                  <span className="history-diff-label">{labelFor(fieldName)}:</span>{' '}
                  <span className="history-diff-before" title={fullBefore}>{before}</span>
                  <span className="history-arrow muted"> → </span>
                  <span className="history-diff-after" title={fullAfter}>{after}</span>
                </li>
              );
            })}
          </ul>
        )}
      </div>
    </li>
  );
}

// Synthetic event entry — "Resource created" / "Resource last updated".
function EventRow({ event }) {
  const when = fmtDateTime(event.ts);
  return (
    <li className="followup-card followup-card--event">
      <header className="followup-head">
        <div className="followup-author">
          <div className="followup-name-line">
            <strong className="event-text">{event.text}</strong>
            {event.username && (
              <>
                <span className="dot muted">·</span>
                <span className="muted small">by {event.username}</span>
              </>
            )}
          </div>
          {when && <span className="muted small">{when}</span>}
        </div>
      </header>
    </li>
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
    if (!(text || '').trim()) {
      setError('Followup text is required.');
      return;
    }
    if (!(author.username || '').trim()) {
      setError('Your name is required.');
      return;
    }
    // Join keys — the followup is meaningless without these, and an
    // empty mcc_no / incidentid would create an orphan record that
    // never reappears in the tab list.
    const mccNo     = String(resource?.request_number_rpt ?? '').trim();
    const incidentId = String(resource?.mission_id_rpt ?? '').trim();
    if (!mccNo) {
      setError('Cannot save — this record has no MCC / request number to tie the followup to.');
      return;
    }
    if (!incidentId) {
      setError('Cannot save — this record has no mission to tie the followup to.');
      return;
    }
    setError('');
    setSubmitting(true);
    try {
      const now = Date.now();

      const attrs = {
        [f.requestNumber]:  mccNo,
        [f.mission]:        incidentId,
        [f.entryDate]:      now,
        [f.entryDateAlt]:   now,                    
        [f.data]:           text.trim(),
        [f.updatedBy]:      (author.username || '').trim(),
        [f.positionId]:     (author.position || '').trim(),
        [f.updatingAgency]: (author.agency   || '').trim(),
        [f.email]:          (author.email    || '').trim(),
      };
      console.info('[Followup] saving attrs:', attrs);
      const result = await addFollowup(attrs);
      console.info('[Followup] save success:', result);
      saveAuthorPrefs(author);
      setText('');
      onSubmitted && onSubmitted();
    } catch (ex) {
      console.error('[Followup] save failed:', ex);
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
