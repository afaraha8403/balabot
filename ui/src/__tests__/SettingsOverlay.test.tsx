import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { SettingsOverlay, type SettingsSection } from '../SettingsOverlay';

describe('SettingsOverlay', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  const ALL_TABS: Array<{ id: SettingsSection; label: string }> = [
    { id: 'general', label: 'General' },
    { id: 'models', label: 'Models' },
    { id: 'memory', label: 'Memory' },
    { id: 'voice', label: 'Voice' },
    { id: 'usage', label: 'Usage' },
    { id: 'computer', label: 'Computer' },
    { id: 'updates', label: 'Updates' },
  ];

  it('renders all 7 navigation tabs in the sidebar', () => {
    const onClose = vi.fn();
    render(<SettingsOverlay onClose={onClose} />);

    const nav = screen.getByTestId('settings-nav');
    expect(nav).toBeInTheDocument();

    for (const tab of ALL_TABS) {
      const tabButton = screen.getByTestId(`settings-nav-${tab.id}`);
      expect(tabButton).toBeInTheDocument();
      expect(tabButton).toHaveTextContent(tab.label);
    }
  });

  it('mounts the initialSection on initial render', () => {
    const onClose = vi.fn();
    render(
      <SettingsOverlay
        initialSection="voice"
        onClose={onClose}
        renderVoice={() => <div data-testid="custom-voice-panel">Voice Settings Active</div>}
      />,
    );

    const dialog = screen.getByTestId('user-settings');
    expect(dialog).toHaveAttribute('data-settings-section', 'voice');

    const voiceTab = screen.getByTestId('settings-nav-voice');
    expect(voiceTab).toHaveAttribute('aria-current', 'page');
    expect(screen.getByTestId('custom-voice-panel')).toBeInTheDocument();
  });

  it('switches between all 7 tabs and mounts the corresponding panel', async () => {
    const user = userEvent.setup();
    const onClose = vi.fn();

    const renderers = {
      renderGeneral: () => <div data-testid="panel-general">General Body</div>,
      renderModels: () => <div data-testid="panel-models">Models Body</div>,
      renderMemory: () => <div data-testid="panel-memory">Memory Body</div>,
      renderVoice: () => <div data-testid="panel-voice">Voice Body</div>,
      renderUsage: () => <div data-testid="panel-usage">Usage Body</div>,
      renderComputer: () => <div data-testid="panel-computer">Computer Body</div>,
      renderUpdates: () => <div data-testid="panel-updates">Updates Body</div>,
    };

    render(<SettingsOverlay onClose={onClose} {...renderers} />);

    const dialog = screen.getByTestId('user-settings');

    // Default is general
    expect(dialog).toHaveAttribute('data-settings-section', 'general');
    expect(screen.getByTestId('panel-general')).toBeInTheDocument();

    // Iterate through every remaining tab and click it
    for (const tab of ALL_TABS) {
      const tabButton = screen.getByTestId(`settings-nav-${tab.id}`);
      await user.click(tabButton);

      expect(dialog).toHaveAttribute('data-settings-section', tab.id);
      expect(tabButton).toHaveAttribute('aria-current', 'page');
      expect(screen.getByTestId(`panel-${tab.id}`)).toBeInTheDocument();

      // Heading should match tab label
      expect(screen.getByRole('heading', { level: 2 })).toHaveTextContent(tab.label);
    }
  });

  it('dismisses dialog when Escape key is pressed', () => {
    const onClose = vi.fn();
    render(<SettingsOverlay onClose={onClose} />);

    fireEvent.keyDown(window, { key: 'Escape', code: 'Escape' });
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it('dismisses dialog when clicking the X close button', async () => {
    const user = userEvent.setup();
    const onClose = vi.fn();
    render(<SettingsOverlay onClose={onClose} />);

    const closeBtn = screen.getByRole('button', { name: /Close General settings/i });
    await user.click(closeBtn);
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it('dismisses dialog when clicking the backdrop outside the modal dialog', () => {
    const onClose = vi.fn();
    const { container } = render(<SettingsOverlay onClose={onClose} />);

    const backdrop = container.querySelector('.polaris-dialog-backdrop') as HTMLElement;
    expect(backdrop).toBeInTheDocument();

    fireEvent.click(backdrop);
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it('does NOT dismiss when clicking inside the modal content', () => {
    const onClose = vi.fn();
    render(<SettingsOverlay onClose={onClose} />);

    const dialog = screen.getByTestId('user-settings');
    fireEvent.click(dialog);
    expect(onClose).not.toHaveBeenCalled();
  });
});
