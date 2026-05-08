import TnBadge from './TnBadge.jsx';

// Tiny shared component so App.jsx and Board.jsx can both render the
// title without a circular import.
export default function Brand() {
  return (
    <div className="brand">
      <TnBadge size={28} />
      <span>Resource Deployment Status</span>
    </div>
  );
}
