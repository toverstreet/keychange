import Image from 'next/image'

/**
 * Maker's credit, sitting beside the product name in the header.
 *
 * Three decisions about the asset, all forced by the logo being drawn for a
 * light context:
 *
 * - It keeps its own black ground rather than being alpha-keyed. The "MULE"
 *   letterforms are dark metallic grey; floated onto this near-black page they
 *   would be close to invisible. A plate of its own is truer to the mark.
 * - Its midtones are lifted by a gamma curve (see public/README.md). Pure black
 *   stays at zero, so the plate still blends into the page, while the
 *   letterforms rise from roughly #343635 to a legible grey. The unmodified
 *   crop is kept beside it as mule-ai-wordmark-original.png.
 * - The wordmark is used rather than the full lockup, because the tagline sets
 *   at about six pixels tall at credit size and reads as mush.
 */
export function PoweredBy() {
  return (
    <div
      className="flex items-center gap-3"
      // A rule rather than plain spacing: next to a 40px wordmark the credit
      // needs a boundary, or it reads as part of the product name.
      style={{ paddingLeft: 20, borderLeft: '1px solid var(--line)' }}
    >
      <span className="legend" style={{ letterSpacing: '0.2em', lineHeight: 1.3, maxWidth: 52 }}>
        Powered by
      </span>

      <a
        href="https://www.muleai.ai"
        target="_blank"
        rel="noopener noreferrer"
        className="display mule-plate"
        style={{ display: 'block', padding: '7px 11px', lineHeight: 0 }}
        aria-label="Mule AI — opens muleai.ai in a new tab"
      >
        <Image
          src="/mule-ai-wordmark.png"
          alt="Mule AI"
          width={440}
          height={135}
          style={{ width: 104, height: 'auto', display: 'block' }}
          priority
        />
      </a>
    </div>
  )
}
