// Tiny shared component so App.jsx and Board.jsx can both render the
// title without a circular import.
export default function Brand() {
  return (
    <div className="brand">
      <span className="brand-dot" />
      <span>Resource Deployment Kanban</span>
    </div>
  );
}
