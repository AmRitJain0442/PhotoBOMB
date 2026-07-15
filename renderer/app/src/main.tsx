import React from 'react';
import {createRoot} from 'react-dom/client';

import '@fontsource/fraunces/400.css';
import '@fontsource/fraunces/600.css';
import '@fontsource/public-sans/400.css';
import '@fontsource/public-sans/500.css';
import '@fontsource/public-sans/700.css';
import './styles.css';

import {App} from './App';

createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>,
);
