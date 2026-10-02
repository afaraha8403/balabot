import {describe, it, expect, vi, beforeEach} from 'vitest';
import {render, screen, fireEvent, waitFor} from '@testing-library/react';
import {RoutineEditor} from '../RoutinesList';
import {RoutineSchedule} from '../RoutineSchedule';
import {ActivityList} from '../ActivityList';
import type {Routine, RoutineRun} from '../api';

// Mock the API module
vi.mock('../api', async () => {
  const actual = await vi.importActual('../api');
  return {
    ...actual,
    getRoutineRuns: vi.fn(),
  };
});

describe('RoutineSchedule', () => {
  it('renders schedule fields from routine record', () => {
    const routine: Routine = {
      id: 'rt_1',
      botId: 'principal',
      title: 'Test Routine',
      schedule: 'Every weekday at 8:00 AM',
      enabled: true,
      lastRun: 'Ran today at 8:00 AM (completed)',
      prompt: 'Test prompt',
    };

    render(<RoutineSchedule routine={routine} />);

    expect(screen.getByText('Every weekday at 8:00 AM')).toBeInTheDocument();
    expect(screen.getByText('Ran today at 8:00 AM (completed)')).toBeInTheDocument();
    expect(screen.getByText('Active')).toBeInTheDocument();
  });

  it('shows paused state when routine is disabled', () => {
    const routine: Routine = {
      id: 'rt_2',
      botId: 'principal',
      title: 'Paused Routine',
      schedule: 'Daily at 9:00 AM',
      enabled: false,
      lastRun: 'Ran yesterday (completed)',
      prompt: '',
    };

    render(<RoutineSchedule routine={routine} />);

    const pausedElements = screen.getAllByText('Paused');
    expect(pausedElements.length).toBeGreaterThan(0);
  });
});

describe('ActivityList', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('renders activity from persisted run data', async () => {
    const {getRoutineRuns} = await import('../api');
    const mockRuns: RoutineRun[] = [
      {
        id: 'run_1',
        botId: 'principal',
        routineId: 'rt_1',
        startedAt: Date.now() / 1000 - 3600,
        finishedAt: Date.now() / 1000 - 3500,
        status: 'completed',
      },
    ];

    vi.mocked(getRoutineRuns).mockResolvedValue({ok: true, runs: mockRuns});

    render(<ActivityList botId="principal" />);

    await waitFor(() => {
      expect(screen.getByText('Recent')).toBeInTheDocument();
    });
  });

  it('shows empty state when no runs exist', async () => {
    const {getRoutineRuns} = await import('../api');
    vi.mocked(getRoutineRuns).mockResolvedValue({ok: true, runs: []});

    render(<ActivityList botId="principal" />);

    await waitFor(() => {
      expect(screen.getByText('No activity yet.')).toBeInTheDocument();
    });
  });
});

describe('RoutineEditor integration', () => {
  it('renders schedule tab when editing existing routine', () => {
    const routine: Routine = {
      id: 'rt_1',
      botId: 'principal',
      title: 'Test Routine',
      schedule: 'Daily',
      enabled: true,
      lastRun: 'Not run yet',
      prompt: 'Test',
    };

    const onBack = vi.fn();
    const onSaved = vi.fn();
    const onDeleted = vi.fn();
    const onNotify = vi.fn();

    render(
      <RoutineEditor
        botId="principal"
        botName="Principal"
        routine={routine}
        onBack={onBack}
        onSaved={onSaved}
        onDeleted={onDeleted}
        onNotify={onNotify}
      />,
    );

    const scheduleTabs = screen.getAllByText('Schedule');
    const scheduleButton = scheduleTabs.find(el => el.tagName === 'BUTTON');
    expect(scheduleButton).toBeInTheDocument();

    fireEvent.click(scheduleButton!);

    // Should show the routine's schedule value in the RoutineSchedule component
    const dailyElements = screen.getAllByText('Daily');
    expect(dailyElements.length).toBeGreaterThan(0);
  });

  it('renders activity tab when editing existing routine', async () => {
    const {getRoutineRuns} = await import('../api');
    vi.mocked(getRoutineRuns).mockResolvedValue({ok: true, runs: []});

    const routine: Routine = {
      id: 'rt_1',
      botId: 'principal',
      title: 'Test Routine',
      schedule: 'Daily',
      enabled: true,
      lastRun: 'Not run yet',
      prompt: 'Test',
    };

    const onBack = vi.fn();
    const onSaved = vi.fn();
    const onDeleted = vi.fn();
    const onNotify = vi.fn();

    render(
      <RoutineEditor
        botId="principal"
        botName="Principal"
        routine={routine}
        onBack={onBack}
        onSaved={onSaved}
        onDeleted={onDeleted}
        onNotify={onNotify}
      />,
    );

    const activityTab = screen.getByText('Activity');
    expect(activityTab).toBeInTheDocument();

    fireEvent.click(activityTab);

    await waitFor(() => {
      expect(screen.getByText('No activity yet.')).toBeInTheDocument();
    });
  });

  it('does not render tabs when creating new routine', () => {
    const onBack = vi.fn();
    const onSaved = vi.fn();
    const onDeleted = vi.fn();
    const onNotify = vi.fn();

    render(
      <RoutineEditor
        botId="principal"
        botName="Principal"
        routine={null}
        onBack={onBack}
        onSaved={onSaved}
        onDeleted={onDeleted}
        onNotify={onNotify}
      />,
    );

    // Should not have tab buttons (only the label "Schedule" for the input field)
    const scheduleElements = screen.queryAllByText('Schedule');
    const scheduleButtons = scheduleElements.filter(el => el.tagName === 'BUTTON');
    expect(scheduleButtons.length).toBe(0);

    const activityButtons = screen.queryAllByText('Activity').filter(el => el.tagName === 'BUTTON');
    expect(activityButtons.length).toBe(0);
  });
});
