import { useState } from 'react';

const BUCKET_LABEL = {
  ilink: 'iLink',
  brand_requested: 'REQUESTED',
  other: 'OTHER'
};

const FRAMING_LABEL = {
  ready_to_rock: 'ready to rock',
  we_can_get_those: 'we can get those'
};

// Renders a small gallery of product thumbnails for the picks Claude saw
// when writing this turn's variants. Click a card to regenerate the
// variants centered on that specific tire. Shift-click or middle-click
// to open the product page in a new tab instead.
export default function InventoryPicks({ meta, onPickClick, disabled }) {
  if (!meta || !meta.triggered) return null;
  const picks = Array.isArray(meta.picks) ? meta.picks : [];
  if (picks.length === 0) return null;

  const header = meta.brand_requested
    ? `${meta.brand_requested} + iLink in ${meta.fired_from_size}`
    : `iLink-first picks in ${meta.fired_from_size}`;

  return (
    <section className="inventory-picks" aria-label="Recommended products">
      <div className="inventory-picks-header">
        <span className="inventory-picks-title">RECOMMENDING</span>
        <span className="inventory-picks-sub">{header}</span>
      </div>
      <div className="inventory-picks-grid">
        {picks.map((p, i) => (
          <PickCard
            key={p.sku || p.url || i}
            pick={p}
            onClick={onPickClick}
            disabled={!!disabled}
          />
        ))}
      </div>
      <p className="inventory-picks-tip">
        Click a card to rewrite the variants centered on that tire. Shift- or middle-click to open the product page in a new tab (right-click the image to save it, or drag into the FB chat thread to attach).
      </p>
    </section>
  );
}

function PickCard({ pick, onClick, disabled }) {
  const [imgFailed, setImgFailed] = useState(false);
  const framing = FRAMING_LABEL[pick.availabilityFraming] || null;
  const bucketLabel = BUCKET_LABEL[pick.bucket] || null;
  const price = pick.priceFormatted || (pick.price ? `$${pick.price.toFixed(2)}` : null);
  const homeQty = pick.homeStock ? pick.homeStock.qty : 0;
  const homeName = pick.homeStock ? pick.homeStock.name : null;
  const network = typeof pick.totalStock === 'number' ? pick.totalStock : 0;
  const warehouse = typeof pick.external === 'number' ? pick.external : 0;
  const hasImage = !!pick.image && !imgFailed;
  const winterOnly = !!pick.winterOnly;

  function handleClick(e) {
    // Shift / Cmd / Ctrl / middle-click → open the product page instead
    // of regenerating. Lets the rep grab the image without rewriting.
    if (e.shiftKey || e.metaKey || e.ctrlKey || e.button === 1) {
      if (pick.url) window.open(pick.url, '_blank', 'noopener,noreferrer');
      e.preventDefault();
      return;
    }
    e.preventDefault();
    if (disabled) return;
    if (typeof onClick === 'function') onClick(pick);
  }

  function handleAuxClick(e) {
    // Middle-click on a link is normally handled by the browser, but
    // since we preventDefault on click, mirror the behavior here.
    if (e.button === 1 && pick.url) {
      window.open(pick.url, '_blank', 'noopener,noreferrer');
      e.preventDefault();
    }
  }

  const cardClass = [
    'pick-card',
    `pick-card-${pick.bucket || 'other'}`,
    winterOnly ? 'pick-card-winter' : '',
    disabled ? 'pick-card-disabled' : ''
  ].filter(Boolean).join(' ');

  return (
    <a
      className={cardClass}
      href={pick.url || '#'}
      onClick={handleClick}
      onAuxClick={handleAuxClick}
      title={`${pick.name} — click to focus variants on this tire (shift-click to open product page)`}
    >
      <div className="pick-thumb">
        {hasImage ? (
          <img
            src={pick.image}
            alt={pick.name}
            loading="lazy"
            onError={() => setImgFailed(true)}
          />
        ) : (
          <span className="pick-thumb-fallback">
            {(pick.brand || '?').slice(0, 4)}
          </span>
        )}
        {bucketLabel && (
          <span className={`pick-bucket-tag pick-bucket-${pick.bucket}`}>
            {bucketLabel}
          </span>
        )}
        {winterOnly && (
          <span className="pick-winter-tag" title="Dedicated winter / snow tire — not all-season">
            WINTER
          </span>
        )}
      </div>
      <div className="pick-meta">
        <p className="pick-name">{pick.name}</p>
        <div className="pick-row">
          {price && <span className="pick-price">{price}</span>}
          {framing && (
            <span className={`pick-framing pick-framing-${pick.availabilityFraming}`}>
              {framing}
            </span>
          )}
        </div>
        <div className="pick-stock">
          {homeName ? `${homeName}: ${homeQty}` : null}
          {network > 0 ? ` · net ${network}` : null}
          {warehouse > 0 ? ` · wh ${warehouse}` : null}
        </div>
      </div>
    </a>
  );
}
