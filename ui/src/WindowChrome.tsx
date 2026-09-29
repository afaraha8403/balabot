import React from 'react';

/**
 * WindowChrome component mirroring Polaris (apps/web/src/pages/WindowChrome.tsx).
 * Renders window drag region (.app-drag) and standard window control buttons
 * (.app-no-drag) for desktop shells and electron wrappers.
 */
export function WindowChrome() {
  const desktop =
    typeof window !== 'undefined'
      ? (window as any).rakazoDesktop || (window as any).balabotDesktop || (window as any).electron
      : undefined;

  return (
    <div
      className="app-drag"
      data-testid="window-chrome"
      style={{
        display: 'flex',
        gap: '7px',
        alignItems: 'center',
        padding: '2px 0',
      }}
    >
      <button
        type="button"
        className="app-no-drag"
        style={{
          width: '12px',
          height: '12px',
          borderRadius: '50%',
          backgroundColor: '#FF5F57',
          border: 'none',
          padding: 0,
          cursor: 'pointer',
          outline: 'none',
          flexShrink: 0,
        }}
        aria-label="Close"
        onClick={() => {
          if (desktop?.window?.close) void desktop.window.close();
          else if (desktop?.close) desktop.close();
        }}
      />
      <button
        type="button"
        className="app-no-drag"
        style={{
          width: '12px',
          height: '12px',
          borderRadius: '50%',
          backgroundColor: '#FEBC2E',
          border: 'none',
          padding: 0,
          cursor: 'pointer',
          outline: 'none',
          flexShrink: 0,
        }}
        aria-label="Minimize"
        onClick={() => {
          if (desktop?.window?.minimize) void desktop.window.minimize();
          else if (desktop?.minimize) desktop.minimize();
        }}
      />
      <button
        type="button"
        className="app-no-drag"
        style={{
          width: '12px',
          height: '12px',
          borderRadius: '50%',
          backgroundColor: '#28C840',
          border: 'none',
          padding: 0,
          cursor: 'pointer',
          outline: 'none',
          flexShrink: 0,
        }}
        aria-label="Fullscreen"
        onClick={() => {
          if (desktop?.window?.toggleMaximize) void desktop.window.toggleMaximize();
          else if (desktop?.maximize) desktop.maximize();
        }}
      />
    </div>
  );
}
