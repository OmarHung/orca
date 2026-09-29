// Why: past this the label can't be read at row size; those files keep their type icon.
export const MAX_SFTP_EXTENSION_LABEL_LENGTH = 5

const SHORT_LABEL_LENGTH = 3

/** Lucide's page outline with the extension printed on a band, as desktop file managers show files. */
export function SftpExtensionIcon({
  extension,
  className
}: {
  extension: string
  className?: string
}): React.JSX.Element {
  const isLong = extension.length > SHORT_LABEL_LENGTH
  return (
    <svg
      viewBox="0 0 24 24"
      aria-hidden
      data-extension={extension}
      className={className}
      fill="none"
      stroke="currentColor"
      strokeWidth={2}
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      <path d="M6 22a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h8a2.4 2.4 0 0 1 1.704.706l3.588 3.588A2.4 2.4 0 0 1 20 8v12a2 2 0 0 1-2 2z" />
      <path d="M14 2v5a1 1 0 0 0 1 1h5" />
      {/* Why: covers the page's bottom edge too, so the band and the outline don't draw a double line. */}
      <rect x="1" y="10.5" width="22" height="12.5" rx="2" fill="currentColor" stroke="none" />
      <text
        x="12"
        y="16.9"
        textAnchor="middle"
        dominantBaseline="central"
        fontSize={isLong ? 8 : 9.5}
        fontWeight={700}
        stroke="none"
        className="fill-background"
        // Why: squeezes 4–5 letter labels onto the band whatever the UI font's widths.
        textLength={isLong ? 20 : undefined}
        lengthAdjust={isLong ? 'spacingAndGlyphs' : undefined}
      >
        {extension}
      </text>
    </svg>
  )
}
