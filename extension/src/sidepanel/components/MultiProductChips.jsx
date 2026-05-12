const PRODUCT_LABELS = {
  wheel: 'WHEELS',
  tire: 'TIRES',
  lift: 'LIFT',
  accessory: 'ACCESSORY'
};

const PRODUCT_ICONS = {
  wheel: '\u{2699}',
  tire: '\u{1F6DE}',
  lift: '\u{1F53C}',
  accessory: '\u{1F527}'
};

export default function MultiProductChips({ products }) {
  if (!Array.isArray(products) || products.length < 2) return null;

  return (
    <div className="multi-product-row" role="status" aria-label="Tracked products">
      <span className="multi-product-label">TRACKING {products.length} PRODUCTS</span>
      <div className="multi-product-chips">
        {products.map((p) => {
          const label = PRODUCT_LABELS[p.productType] || String(p.productType || '').toUpperCase();
          const icon = PRODUCT_ICONS[p.productType] || '\u{25CF}';
          const qualified = p.productState === 'qualified';
          return (
            <span
              key={p.productType}
              className={`multi-product-chip ${qualified ? 'mp-chip-qualified' : 'mp-chip-qualifying'}`}
              title={qualified ? 'Qualified' : 'Qualifying'}
            >
              <span className="mp-chip-icon" aria-hidden="true">{icon}</span>
              <span className="mp-chip-label">{label}</span>
              <span className="mp-chip-state">{qualified ? 'OK' : '…'}</span>
            </span>
          );
        })}
      </div>
    </div>
  );
}
