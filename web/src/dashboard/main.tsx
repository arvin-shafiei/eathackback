import React from 'react';
import ReactDOM from 'react-dom/client';
import App from './App';
import '../styles.css'; // shared tokens (read-only); dashboard.css overrides page-level rules
import './dashboard.css';

ReactDOM.createRoot(document.getElementById('dash-root')!).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>,
);
