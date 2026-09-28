// BalaBot theme — near-black X/Grok palette (see DESIGN-SPEC.md).
// Build with: npx @astryxdesign/cli theme build src/theme.ts
import {defineTheme} from '@astryxdesign/core/theme';

export const balabotTheme = defineTheme({
  name: 'balabot',
  color: {accent: '#1d9bf0', neutralStyle: 'neutral', contrast: 'high'},
  typography: {
    scale: {base: 16, ratio: 1.2},
    body: {family: 'Inter', fallbacks: '-apple-system, system-ui, sans-serif'},
    heading: {weight: 'semibold'},
  },
  radius: {base: 4, multiplier: 1.5},
  tokens: {
    // Astryx token pairs are [light, dark] and follow data-theme. Both entries
    // used to be the dark value, so Astryx-styled components stayed near-black in
    // light mode while our tokens.css layer switched — half-themed UI. The light
    // entries below mirror the light values in tokens.css so both layers agree.
    '--color-background-body': ['#fafaf8', '#000000'],
    '--color-background-surface': ['#ecece9', '#16181c'],
    '--color-background-card': ['#ffffff', '#202327'],
    '--color-background-popover': ['#ffffff', '#202327'],
    '--color-background-muted': ['#f0f0ed', '#20232766'],
    '--color-text-primary': ['#1a1a1a', '#ffffff'],
    '--color-text-secondary': ['#6c6c70', '#71767b'],
    '--color-border': ['#e8e8e4', '#2a2a2a'],
    '--color-border-emphasized': ['#d8d8d2', '#3e4144'],
    // Overlays stay dark in both modes: they are scrims over content.
    '--color-overlay': ['#00000066', '#00000066'],
    '--color-overlay-hover': ['#0000000c', '#ffffff0c'],
    '--color-overlay-pressed': ['#00000019', '#ffffff19'],
    '--color-accent': ['#1d9bf0', '#1d9bf0'],
    '--color-on-accent': ['#000000', '#000000'],
    // Primary button inverts against the page: white-on-black in dark mode,
    // near-black-on-cream in light. Its label reads the body background token.
    '--color-background-inverted': ['#111111', '#ffffff'],
  },
  components: {
    'chat-message-bubble': {
      base: {
        borderRadius: 'var(--radius-chat)',
        paddingBlock: 'var(--spacing-3)',
        paddingInline: 'var(--spacing-4)',
      },
    },
    'side-nav-item': {
      base: {borderRadius: 'var(--radius-element)'},
    },
  },
});
