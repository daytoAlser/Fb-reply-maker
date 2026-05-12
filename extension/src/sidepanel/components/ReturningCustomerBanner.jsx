const HOUR_MS = 60 * 60 * 1000;
const DAY_MS = 24 * HOUR_MS;
const WEEK_MS = 7 * DAY_MS;

export function formatSilenceGap(ms) {
  if (typeof ms !== 'number' || !isFinite(ms) || ms <= 0) return 'just now';
  if (ms < HOUR_MS) {
    const m = Math.max(1, Math.round(ms / (60 * 1000)));
    return `${m} min`;
  }
  if (ms < DAY_MS) {
    const h = Math.max(1, Math.round(ms / HOUR_MS));
    return h === 1 ? '1 hour' : `${h} hours`;
  }
  if (ms < WEEK_MS) {
    const d = Math.max(1, Math.round(ms / DAY_MS));
    return d === 1 ? '1 day' : `${d} days`;
  }
  if (ms < 30 * DAY_MS) {
    const d = Math.max(1, Math.round(ms / DAY_MS));
    return `${d} days`;
  }
  const w = Math.max(1, Math.round(ms / WEEK_MS));
  return w === 1 ? '1 week' : `${w} weeks`;
}

export default function ReturningCustomerBanner({ silenceDurationMs, priorStatus, reason }) {
  const gapLabel = formatSilenceGap(silenceDurationMs);
  const subtitle = priorStatus
    ? `${gapLabel} since last contact · last status: ${priorStatus}`
    : `${gapLabel} since last contact`;
  return (
    <div className="returning-banner" role="status" aria-label="Returning customer">
      <span className="returning-banner-icon" aria-hidden="true">{'\u{1F501}'}</span>
      <span className="returning-banner-title">RETURNING CUSTOMER</span>
      <span className="returning-banner-body">
        {subtitle}
        {reason === 'language' && ' · resumption phrase detected'}
        {reason === 'gap' && ' · 48h+ silence'}
      </span>
      <span className="returning-banner-hint">Variants below skip the formal opener and use the casual re-entry voice.</span>
    </div>
  );
}
