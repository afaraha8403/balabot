// BalaBot theme — mirrored from Polaris design tokens.
// Build with: .\node_modules\.bin\astryx.cmd theme build src\theme.ts
import {defineTheme} from '@astryxdesign/core/theme';

export const balabotTheme = defineTheme({
  name: 'balabot',
  color: {accent: '#3b82f6', neutralStyle: 'neutral', contrast: 'high'},
  typography: {
    scale: {base: 16, ratio: 1.2},
    body: {
      family: 'Geist Variable',
      fallbacks: 'ui-sans-serif, system-ui, -apple-system, sans-serif',
      weight: 'normal',
    },
    heading: {
      family: 'Geist Variable',
      fallbacks: 'ui-sans-serif, system-ui, -apple-system, sans-serif',
      weight: 'semibold',
    },
    code: {
      family: 'Geist Mono',
      fallbacks: 'ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace',
      weight: 'normal',
    },
  },
  radius: {base: 4, multiplier: 1.5},
  tokens: {
    // Astryx token pairs are [light, dark] and follow data-theme.
    // Explicitly aligned to Polaris design tokens across both themes.
    '--color-background-body': ['#fafaf8', '#0b0c0e'],
    '--color-background-surface': ['#ecece9', '#111215'],
    '--color-background-card': ['#ffffff', '#141518'],
    '--color-background-popover': ['#ffffff', '#141518'],
    '--color-background-muted': ['#f0f0ed', '#141518'],
    '--color-text-primary': ['#1a1a1a', '#ececee'],
    '--color-text-secondary': ['#6c6c70', '#85858a'],
    '--color-border': ['#f0f0ed', '#1e2026'],
    '--color-border-emphasized': ['#e8e8e4', '#1c1d22'],
    '--color-overlay': ['rgba(20, 20, 22, 0.45)', 'rgba(4, 4, 5, 0.72)'],
    '--color-overlay-hover': ['rgba(0, 0, 0, 0.05)', 'rgba(255, 255, 255, 0.05)'],
    '--color-overlay-pressed': ['rgba(0, 0, 0, 0.1)', 'rgba(255, 255, 255, 0.1)'],
    '--color-accent': ['#eaeae6', '#1a1b20'],
    '--color-on-accent': ['#1a1a1a', '#ececee'],
    '--color-background-inverted': ['#1a1a1a', '#f1f1ef'],
  },
  components: {
    'chat-message-bubble': {
      base: {
        borderRadius: 'var(--radius-xl)',
        paddingBlock: 'var(--spacing-3)',
        paddingInline: 'var(--spacing-4)',
      },
    },
    'side-nav-item': {
      base: {borderRadius: 'var(--radius-md)'},
    },
  },
});
