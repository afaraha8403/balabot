import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { SettingsOverlay } from '../SettingsOverlay';

describe('MessagingSettings panel mount', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    localStorage.clear();
  });

  it('renders messaging tab in the nav', () => {
    const onClose = vi.fn();
    render(<SettingsOverlay onClose={onClose} />);

    const messagingTab = screen.getByTestId('settings-nav-messaging');
    expect(messagingTab).toBeInTheDocument();
    expect(messagingTab).toHaveTextContent('Messaging');
  });

  it('mounts the MessagingSettings panel when messaging tab is clicked', async () => {
    const user = userEvent.setup();
    const onClose = vi.fn();
    render(<SettingsOverlay onClose={onClose} />);

    const messagingTab = screen.getByTestId('settings-nav-messaging');
    await user.click(messagingTab);

    const dialog = screen.getByTestId('user-settings');
    expect(dialog).toHaveAttribute('data-settings-section', 'messaging');
    expect(messagingTab).toHaveAttribute('aria-current', 'page');

    const panel = screen.getByTestId('messaging-settings');
    expect(panel).toBeInTheDocument();
    expect(screen.getByText('Bot Messaging Preferences')).toBeInTheDocument();
  });

  it('switches from general to messaging and mounts the panel', async () => {
    const user = userEvent.setup();
    const onClose = vi.fn();
    render(<SettingsOverlay onClose={onClose} />);

    const dialog = screen.getByTestId('user-settings');
    expect(dialog).toHaveAttribute('data-settings-section', 'general');

    const messagingTab = screen.getByTestId('settings-nav-messaging');
    await user.click(messagingTab);

    expect(dialog).toHaveAttribute('data-settings-section', 'messaging');
    expect(messagingTab).toHaveAttribute('aria-current', 'page');
    expect(screen.getByTestId('messaging-settings')).toBeInTheDocument();
  });

  it('heading displays "Messaging" when messaging tab is active', async () => {
    const user = userEvent.setup();
    const onClose = vi.fn();
    render(<SettingsOverlay onClose={onClose} />);

    const messagingTab = screen.getByTestId('settings-nav-messaging');
    await user.click(messagingTab);

    expect(screen.getByRole('heading', { level: 2 })).toHaveTextContent('Messaging');
  });
});
