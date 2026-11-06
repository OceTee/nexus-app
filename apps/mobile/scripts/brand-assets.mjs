// Renders the app icon, Android adaptive icon layers and splash image from the
// NEXUS brand SVGs in assets/brand. Run after changing the brand art:
//   node scripts/brand-assets.mjs
import { readFileSync, writeFileSync } from 'node:fs';
import { Resvg } from '@resvg/resvg-js';

const brand = (f) => readFileSync(new URL(`../assets/brand/${f}`, import.meta.url), 'utf8');
const out = (f) => new URL(`../assets/images/${f}`, import.meta.url);

function render(svg, width, file) {
  const png = new Resvg(svg, {
    fitTo: { mode: 'width', value: width },
    background: 'rgba(0,0,0,0)',
  })
    .render()
    .asPng();
  writeFileSync(out(file), png);
  console.log(`${file} ${width}px`);
}

// App icon (iOS and legacy Android) and web favicon.
render(brand('nexus_app_icon.svg'), 1024, 'icon.png');
render(brand('nexus_app_icon.svg'), 48, 'favicon.png');

// Android adaptive icon layers.
render(brand('nexus_adaptive_foreground.svg'), 1024, 'android-icon-foreground.png');
render(brand('nexus_adaptive_background.svg'), 1024, 'android-icon-background.png');
// Monochrome (themed icons): the mark in a single colour; Android uses alpha only.
render(
  brand('nexus_adaptive_foreground.svg').replace(/#[0-9A-Fa-f]{6}/g, '#FFFFFF'),
  1024,
  'android-icon-monochrome.png',
);

// Splash: reversed stacked lockup (white mark and wordmark, amber spark) for the
// Cobalt background (TDD Section C). Derived from the stacked logo by colour swap.
const reversed = brand('nexus_logo_stacked.svg')
  .replace(/#1C2340/gi, '#FFFFFF')
  .replace(/#3B5BDB/gi, '#FFFFFF');
render(reversed, 640, 'splash-icon.png');
