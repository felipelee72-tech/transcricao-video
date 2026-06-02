import React from 'react';
import { createRoot } from 'react-dom/client';
import App from './App.jsx';
import DebugPage from './DebugPage.jsx';
import './styles.css';

const isDebugRoute =
  window.location.pathname === '/debug' || window.location.pathname.startsWith('/debug/');

createRoot(document.getElementById('root')).render(
  <React.StrictMode>{isDebugRoute ? <DebugPage /> : <App />}</React.StrictMode>,
);