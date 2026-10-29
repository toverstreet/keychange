# Public assets

`mule-ai-wordmark.png` — the Mule AI wordmark, used in the "Powered by" credit.

Derived from `~/Desktop/MuleAI/Logos/muleAI-V4.png` (the current logo) by:

1. Cropping to the content bounding box with an 18 px margin of the logo's own
   ground, stopping just above the hairline rule so the tagline is excluded.
   The tagline sets at roughly six pixels tall at credit size and reads as mush.
2. Lifting midtones with a gamma curve of 0.72. The mark was built for a light
   context: its "MULE" letterforms are dark metallic grey (~#343635) and are
   close to invisible on this app's near-black ground. The curve leaves pure
   black at 0, so the plate still blends into the page, and leaves white and the
   blue "AI" essentially alone, while raising the letterforms to about #515151.
3. Resizing to 440 px wide, displayed at 132 px for retina.

`mule-ai-wordmark-original.png` is the same crop without the midtone lift, kept
so the unmodified mark is one import away if the adjustment is unwanted.

Regenerate either with the recipe above; the source logo is not in this repo.
