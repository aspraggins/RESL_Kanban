import { useDroppable } from '@dnd-kit/core';
import { FIELDS } from '../config.js';
import Card from './Card.jsx';

export default function Column({ id, label, accent, resources, pending, droppable }) {
  const { isOver, setNodeRef } = useDroppable({ id, disabled: !droppable });

  return (
    <div
      ref={droppable ? setNodeRef : undefined}
      className={`column${isOver ? ' is-over' : ''}${droppable ? '' : ' is-static'}`}
      style={{ '--column-accent': accent }}
    >
      <header className="column-header">
        <span className="column-dot" />
        <span className="column-label">{label}</span>
        <span className="column-count">{resources.length}</span>
      </header>
      <div className="column-body">
        {resources.map((r) => (
          <Card
            key={r[FIELDS.objectId]}
            r={r}
            pending={pending.has(r[FIELDS.objectId])}
          />
        ))}
        {droppable && resources.length === 0 && (
          <div className="empty-hint">Drop here</div>
        )}
      </div>
    </div>
  );
}
