import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { SettingsOverlay } from '../SettingsOverlay';

describe('ApprovalRulesSettings panel mount', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    localStorage.clear();
  });

  it('renders approvals tab in the nav', () => {
    const onClose = vi.fn();
    render(<SettingsOverlay onClose={onClose} />);

    const approvalsTab = screen.getByTestId('settings-nav-approvals');
    expect(approvalsTab).toBeInTheDocument();
    expect(approvalsTab).toHaveTextContent('Approvals');
  });

  it('mounts the ApprovalRulesSettings panel when approvals tab is clicked', async () => {
    const user = userEvent.setup();
    const onClose = vi.fn();
    render(<SettingsOverlay onClose={onClose} />);

    const approvalsTab = screen.getByTestId('settings-nav-approvals');
    await user.click(approvalsTab);

    const dialog = screen.getByTestId('user-settings');
    expect(dialog).toHaveAttribute('data-settings-section', 'approvals');
    expect(approvalsTab).toHaveAttribute('aria-current', 'page');

    const panel = screen.getByTestId('approval-rules-settings');
    expect(panel).toBeInTheDocument();
    expect(screen.getByText('Tool Approval Rules')).toBeInTheDocument();
  });

  it('switches from general to approvals and mounts the panel', async () => {
    const user = userEvent.setup();
    const onClose = vi.fn();
    render(<SettingsOverlay onClose={onClose} />);

    const dialog = screen.getByTestId('user-settings');
    expect(dialog).toHaveAttribute('data-settings-section', 'general');

    const approvalsTab = screen.getByTestId('settings-nav-approvals');
    await user.click(approvalsTab);

    expect(dialog).toHaveAttribute('data-settings-section', 'approvals');
    expect(approvalsTab).toHaveAttribute('aria-current', 'page');
    expect(screen.getByTestId('approval-rules-settings')).toBeInTheDocument();
  });

  it('heading displays "Approvals" when approvals tab is active', async () => {
    const user = userEvent.setup();
    const onClose = vi.fn();
    render(<SettingsOverlay onClose={onClose} />);

    const approvalsTab = screen.getByTestId('settings-nav-approvals');
    await user.click(approvalsTab);

    expect(screen.getByRole('heading', { level: 2 })).toHaveTextContent('Approvals');
  });
});
