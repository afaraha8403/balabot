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
    // Near-black X/Grok surfaces (dark mode values used in both modes).
    '--color-background-body': ['#000000', '#000000'],
    '--color-background-surface': ['#16181c', '#16181c'],
    '--color-background-card': ['#202327', '#202327'],
    '--color-background-popover': ['#202327', '#202327'],
    '--color-background-muted': ['#20232766', '#20232766'],
    '--color-text-primary': ['#ffffff', '#ffffff'],
    '--color-text-secondary': ['#71767b', '#71767b'],
    '--color-border': ['#2a2a2a', '#2a2a2a'],
    '--color-border-emphasized': ['#3e4144', '#3e4144'],
    '--color-overlay': ['#00000066', '#00000066'],
    '--color-overlay-hover': ['#ffffff0c', '#ffffff0c'],
    '--color-overlay-pressed': ['#ffffff19', '#ffffff19'],
    '--color-accent': ['#1d9bf0', '#1d9bf0'],
    '--color-on-accent': ['#000000', '#000000'],
    // Primary button: white bg, black text.
    '--color-background-inverted': ['#ffffff', '#ffffff'],
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
