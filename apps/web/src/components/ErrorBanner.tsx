export interface ErrorBannerProps {
  message: string;
  detail?: string | undefined;
  onRetry?: (() => void) | undefined;
  onDismiss?: (() => void) | undefined;
}

/** Prominent banner shown when the API is failing (e.g. an injected fault). */
export function ErrorBanner({
  message,
  detail,
  onRetry,
  onDismiss,
}: ErrorBannerProps): JSX.Element {
  return (
    <div className="banner banner--error" role="alert">
      <div className="banner__body">
        <strong className="banner__title">{message}</strong>
        {detail ? <p className="banner__detail">{detail}</p> : null}
      </div>
      <div className="banner__actions">
        {onRetry ? (
          <button type="button" className="button button--ghost" onClick={onRetry}>
            Retry
          </button>
        ) : null}
        {onDismiss ? (
          <button
            type="button"
            className="button button--ghost"
            aria-label="Dismiss error"
            onClick={onDismiss}
          >
            ✕
          </button>
        ) : null}
      </div>
    </div>
  );
}
