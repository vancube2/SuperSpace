import React from 'react';
import { createRoot } from 'react-dom/client';
import App from './App';
import './index.css';

import process from 'process';
window.process = process;

// Polyfill process.nextTick for browser
if (typeof window !== 'undefined' && !window.process) {
  window.process = {
    nextTick: (fn, ...args) => setTimeout(() => fn(...args), 0),
  };
}

const container = document.getElementById('root');
const root = createRoot(container);
root.render(
  <React.StrictMode>
    <App />
  </React.StrictMode>
);