/*
 * The secret look's mark: an original monogram - three rising bars, the
 * dashboard's subject - on an ink tile with a violet edge light. Drawn here,
 * not borrowed. Shown only in the "aman" look and in its switch.
 */
export function AmanMark() {
  return (
    <span className="aman-mark" aria-hidden="true">
      <svg viewBox="0 0 40 40" width="32" height="32">
        <defs>
          <linearGradient id="aman-mark-edge" x1="0" y1="0" x2="1" y2="1">
            <stop offset="0" style={{ stopColor: 'var(--aman-accent, #5b4cd6)' }} />
            <stop offset="1" style={{ stopColor: 'var(--series-imports, #2f6fb5)' }} />
          </linearGradient>
        </defs>
        <rect x="0.5" y="0.5" width="39" height="39" rx="10" fill="#18181b" stroke="url(#aman-mark-edge)" strokeWidth="1.5" />
        <rect x="10" y="20" width="4.5" height="10" rx="2.25" fill="#ffffff" opacity="0.55" />
        <rect x="17.75" y="14" width="4.5" height="16" rx="2.25" fill="#ffffff" opacity="0.8" />
        <rect x="25.5" y="9" width="4.5" height="21" rx="2.25" fill="url(#aman-mark-edge)" />
      </svg>
    </span>
  )
}
