/*
 * The secret look's mark: an original monogram (an "H" built from three
 * rising bars, the dashboard's subject), drawn here rather than borrowed.
 * Shown only in the "aman" look; the FED logo is the mark everywhere else.
 */
export function AmanMark() {
  return (
    <span className="aman-mark" aria-hidden="true">
      <svg viewBox="0 0 40 40" width="34" height="34">
        <defs>
          <linearGradient id="aman-mark-fill" x1="0" y1="1" x2="1" y2="0">
            <stop offset="0" style={{ stopColor: "var(--aman-a)" }} />
            <stop offset="0.55" style={{ stopColor: "var(--aman-b)" }} />
            <stop offset="1" style={{ stopColor: "var(--aman-c)" }} />
          </linearGradient>
        </defs>
        <rect x="1" y="1" width="38" height="38" rx="11" fill="url(#aman-mark-fill)" />
        <rect x="9" y="17" width="5" height="14" rx="2.5" fill="#fff" opacity="0.95" />
        <rect x="17.5" y="11" width="5" height="20" rx="2.5" fill="#fff" />
        <rect x="26" y="8" width="5" height="23" rx="2.5" fill="#fff" opacity="0.95" />
        <rect x="9" y="19.5" width="22" height="4" rx="2" fill="#fff" opacity="0.55" />
      </svg>
    </span>
  )
}
