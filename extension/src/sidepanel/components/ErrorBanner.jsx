export default function ErrorBanner({ message }) {
  return (
    <div className="error-banner" role="alert">
      <span className="label-mono">ERROR</span>
      <span className="error-body">{message}</span>
    </div>
  );
}
