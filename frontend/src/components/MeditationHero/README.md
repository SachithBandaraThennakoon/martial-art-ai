# MeditationHero body asset

The component works immediately with its built-in CSS lotus silhouette.

For a more detailed particle body, place a transparent WebP or PNG at:

`public/images/meditation-body-transparent.png`

The current asset is the user-supplied transparent particle body. Its seven energy points use anatomy-specific positions for the crown, brow, throat, heart, solar plexus, sacral, and root. Rings, waves, floating particles, and the central line remain separate React/CSS layers so they animate independently. A missing asset automatically falls back to the CSS silhouette.

You can also pass a custom public URL with the `bodyAsset` prop:

```jsx
<MeditationHero bodyAsset="/images/my-lotus-body.png" />
```
