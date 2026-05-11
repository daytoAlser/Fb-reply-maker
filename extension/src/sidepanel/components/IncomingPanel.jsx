export default function IncomingPanel({ value, onChange }) {
  return (
    <section className="panel">
      <div className="panel-head">
        <label className="label-mono" htmlFor="incoming-textarea">INCOMING MESSAGE</label>
        <span className="hint">{value.length} chars</span>
      </div>
      <textarea
        id="incoming-textarea"
        className="textarea"
        rows={4}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder="Paste the FB Marketplace message here…"
        spellCheck={false}
      />
    </section>
  );
}
