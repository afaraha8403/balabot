import React, { createContext, useContext } from 'react';

export interface OpenUIContextValue {
  disabled?: boolean;
  superseded?: boolean;
}

export const OpenUIContext = createContext<OpenUIContextValue>({
  disabled: false,
  superseded: false,
});

export function useOpenUIContext(): OpenUIContextValue {
  return useContext(OpenUIContext);
}
