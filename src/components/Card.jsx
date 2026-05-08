import { useDraggable } from '@dnd-kit/core';
import { CSS } from '@dnd-kit/utilities';
import { FIELDS } from '../config.js';

export default function Card({ r, pending = false, dragging = false, draggable = true }) {
  // When rendered inside <DragOverlay /> we pass `dragging` so the card is
  // a plain visual — it must NOT register as a draggable (that would
  // duplicate the source's id).
  if (dragging) return <CardView r={r} pending={pending} dragging />;
  return <DraggableCard r={r} pending={pending} draggable={draggable} />;
}

function DraggableCard({ r, pending, draggable }) {
  const oid = r[FIELDS.objectId];
  const { attributes, listeners, setNodeRef, transform, isDragging } = useDraggable({
    id: String(oid),
    disabled: !draggable,
  });

  // Source card: when an overlay is active for this id, hide it (set the
  // overlay handle's transform-driven motion against a fixed source).
  const style = {
    transform: CSS.Translate.toString(transform),
    opacity: isDragging ? 0 : 1,
  };

  return (
    <CardView
      r={r}
      pending={pending}
      style={style}
      forwardRef={setNodeRef}
      handleProps={{ ...attributes, ...listeners }}
    />
  );
}

function CardView({ r, pending, style, dragging = false, forwardRef, handleProps = {} }) {
  const oid = r[FIELDS.objectId];
  const name = r[FIELDS.resourceName] || r[FIELDS.resourceType] || `Resource ${oid}`;
  const subtitle = [r[FIELDS.resourceType], r[FIELDS.agency]].filter(Boolean).join(' · ');
  const contact  = [r[FIELDS.contact], r[FIELDS.phone]].filter(Boolean).join(' · ');

  return (
    <div
      ref={forwardRef}
      style={style}
      className={`card${dragging ? ' is-dragging' : ''}${pending ? ' is-pending' : ''}`}
      {...handleProps}
    >
      <div className="card-title">{name}</div>
      {subtitle && <div className="card-subtitle">{subtitle}</div>}
      {contact && <div className="card-contact">{contact}</div>}
      <div className="card-meta">
        <span className="card-oid">#{oid}</span>
        {pending && <span className="card-pending">Saving…</span>}
      </div>
    </div>
  );
}
