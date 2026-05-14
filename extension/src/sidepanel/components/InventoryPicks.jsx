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
// when writing this turn's variants. Click a card to open the product page
// in a new tab (rep can right-click → save image, or drag the image into
// the FB chat thread as an attachment).
export default function InventoryPicks({ meta }) {
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
          <PickCard key={p.sku || p.url || i} pick={p} />
        ))}
      </div>
      <p className="inventory-picks-tip">
        Click a card to open the product page. Right-click an image to save it, or drag it into the FB chat thread to attach.
      </p>
    </section>
  );
}

function PickCard({ pick }) {
  const [imgFailed, setImgFailed] = useState(false);
  const framing = FRAMING_LABEL[pick.availabilityFraming] || null;
  const bucketLabel = BUCKET_LABEL[pick.bucket] || null;
  const price = pick.priceFormatted || (pick.price ? `$${pick.price.toFixed(2)}` : null);
  const homeQty = pick.homeStock ? pick.homeStock.qty : 0;
  const homeName = pick.homeStock ? pick.homeStock.name : null;
  const network = typeof pick.totalStock === 'number' ? pick.totalStock : 0;
  const warehouse = typeof pick.external === 'number' ? pick.external : 0;
  const hasImage = !!pick.image && !imgFailed;

  function openProduct(e) {
    e.preventDefault();
    if (pick.url) window.open(pick.url, '_blank', 'noopener,noreferrer');
  }

  return (
    <a
      className={`pick-card pick-card-${pick.bucket || 'other'}`}
      href={pick.url || '#'}
      target="_blank"
      rel="noopener noreferrer"
      onClick={openProduct}
      title={pick.name}
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
