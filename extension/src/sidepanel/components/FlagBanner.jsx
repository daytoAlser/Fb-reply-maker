const FLAG_META = {
  fitment:  { label: 'FITMENT',  icon: '\u{1F6A8}', color: 'red',    singleTitle: 'FITMENT QUESTION DETECTED',  singleBody: 'Holding reply ready below. Confirm fitment manually before normal reply.' },
  pricing:  { label: 'PRICING',  icon: '\u{1F4B0}', color: 'yellow', singleTitle: 'PRICING QUESTION DETECTED',  singleBody: 'Estimate workflow reply ready below. Override for general pricing discussion.' },
  timeline: { label: 'TIMELINE', icon: '\u{1F4C5}', color: 'yellow', singleTitle: 'TIMELINE QUESTION DETECTED', singleBody: 'Holding reply ready below. Confirm lead time before commitments.' }
};

const PRIORITY = ['fitment', 'pricing', 'timeline'];

function sortByPriority(flags) {
  return [...flags].sort((a, b) => PRIORITY.indexOf(a) - PRIORITY.indexOf(b));
}

export default function FlagBanner({ flags = [], overrideActive = false, onOverride, loading = false }) {
  if (overrideActive) {
    return (
      <div className="flag-banner flag-banner-override" role="status">
        <div className="flag-banner-head">
          <span className="flag-banner-icon" aria-hidden="true">{'\u{1F7E2}'}</span>
          <span className="flag-banner-title">OVERRIDE ACTIVE</span>
        </div>
        <p className="flag-banner-body">Variants below ignore flag. Review before send.</p>
      </div>
    );
  }

  const valid = sortByPriority(flags.filter((f) => FLAG_META[f]));
  if (valid.length === 0) return null;

  const primary = valid[0];
  const meta = FLAG_META[primary];

  let title, body, icon, color;
  if (valid.length === 1) {
    title = meta.singleTitle;
    body = meta.singleBody;
    icon = meta.icon;
    color = meta.color;
  } else {
    const labels = valid.map((f) => FLAG_META[f].label).join(' + ');
    title = `MULTIPLE FLAGS: ${labels}`;
    body = 'Combined holding reply ready below.';
    icon = valid.includes('fitment') ? FLAG_META.fitment.icon : FLAG_META.pricing.icon;
    color = valid.includes('fitment') ? 'red' : 'yellow';
  }

  return (
    <div className={`flag-banner flag-banner-${color}`} role="alert">
      <div className="flag-banner-head">
        <span className="flag-banner-icon" aria-hidden="true">{icon}</span>
        <span className="flag-banner-title">{title}</span>
      </div>
      <p className="flag-banner-body">{body}</p>
      <button
        type="button"
        className="flag-banner-override-btn"
        onClick={onOverride}
        disabled={loading}
      >
        {loading ? 'Generating…' : 'Generate Normal Reply Anyway'}
      </button>
    </div>
  );
}
