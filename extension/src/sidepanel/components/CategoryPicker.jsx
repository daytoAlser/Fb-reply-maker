const LABELS = {
  auto: 'Auto',
  availability: 'Avail',
  fitment: 'Fitment',
  price_haggle: 'Price',
  location_hours: 'Hours',
  delivery_shipping: 'Ship',
  stock_check: 'Stock',
  install_service: 'Install',
  trade_in: 'Trade',
  other: 'Other'
};

export default function CategoryPicker({ categories, value, onChange }) {
  return (
    <section className="panel">
      <label className="label-mono">CATEGORY</label>
      <div className="chip-grid">
        {categories.map((c) => (
          <button
            key={c}
            type="button"
            className={`chip ${value === c ? 'chip-active' : ''}`}
            onClick={() => onChange(c)}
            title={c}
          >
            {LABELS[c] || c}
          </button>
        ))}
      </div>
    </section>
  );
}
