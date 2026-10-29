import Image from 'next/image'

/**
 * Maker's credit, styled as the engraved nameplate on the bottom rail of a
 * rack unit.
 *
 * Three decisions about the asset, all forced by the logo being built for a
 * light context:
 *
 * - It keeps its own black ground rather than being alpha-keyed. The "MULE"
 *   letterforms are dark metallic grey; floated onto this near-black page they
 *   would be close to invisible. A plate of its own is truer to the mark.
 * - Its midtones are lifted by a gamma curve (see the build note in the repo).
 *   Pure black stays at zero, so the plate still blends into the page, while
 *   the letterforms rise from roughly #343635 to a legible grey. The
 *   unmodified crop is kept beside it as mule-ai-wordmark-original.png.
 * - The wordmark is used rather than the full lockup, because the tagline sets
 *   at about six pixels tall at credit size and reads as mush.
 */
export function PoweredBy() {
  return (
    <footer
      className="flex items-center justify-center gap-4 mt-10"
      style={{ paddingTop: 28, borderTop: '1px solid var(--line)' }}
    >
      <span className="legend" style={{ letterSpacing: '0.28em' }}>
        Powered by
      </span>

      <a
        href="https://www.muleai.ai"
        target="_blank"
        rel="noopener noreferrer"
        className="display mule-plate"
        style={{ display: 'block', padding: '9px 14px', lineHeight: 0 }}
        aria-label="Mule AI — opens muleai.ai in a new tab"
      >
        <Image
          src="/mule-ai-wordmark.png"
          alt="Mule AI"
          width={440}
          height={135}
          style={{ width: 132, height: 'auto', display: 'block' }}
          priority={false}
        />
      </a>
    </footer>
  )
}
