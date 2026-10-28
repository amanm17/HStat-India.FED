/*
 * The secret look's mark: an original monogram - three rising bars, the
 * dashboard's subject - in titanium on a graphite tile, with the livery
 * pinstripe (red over blue) as its baseline. Drawn here, not borrowed.
 * Shown only in the "aman" look.
 */
export function AmanMark() {
  return (
    <span className="aman-mark" aria-hidden="true">
      <svg viewBox="0 0 40 40" width="32" height="32">
        <rect x="0.5" y="0.5" width="39" height="39" rx="8" fill="#0b0d10" stroke="#8a929c" strokeOpacity="0.55" />
        <rect x="10" y="19" width="4.5" height="10" rx="1" fill="#c5cbd3" opacity="0.55" />
        <rect x="17.75" y="14" width="4.5" height="15" rx="1" fill="#c5cbd3" opacity="0.8" />
        <rect x="25.5" y="9" width="4.5" height="20" rx="1" fill="#e6e9ed" />
        <rect x="9" y="31.5" width="22" height="1.25" fill="#ff3b4e" />
        <rect x="9" y="33.75" width="22" height="1.25" fill="#4d84ff" />
      </svg>
    </span>
  )
}
