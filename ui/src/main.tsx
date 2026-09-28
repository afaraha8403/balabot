import {StrictMode} from 'react';
import {createRoot} from 'react-dom/client';
import {Theme} from '@astryxdesign/core/theme';
import {balabotTheme} from './balabot';
import '@astryxdesign/core/reset.css';
import '@astryxdesign/core/astryx.css';
import './tokens.css';
import './balabot.css';
import App from './App';

document.title = 'BalaBot';

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <Theme theme={balabotTheme}>
      <App />
    </Theme>
  </StrictMode>,
);
