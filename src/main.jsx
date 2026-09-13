import React from 'react';
import ReactDOM from 'react-dom/client';
// HashRouter, where the app uses BrowserRouter. The difference is the
// host, not a preference: a static host has no rewrite rule, so a deep
// link to /stock-placement asks for a file that does not exist and 404s
// on refresh or on a shared link. The hash keeps the whole route on the
// client, which is what makes this build droppable on GitHub Pages, any
// object store, or a local folder with no configuration at all.
import { HashRouter } from 'react-router-dom';
import App from './App.jsx';
import { AuthProvider } from './auth/AuthProvider.jsx';
import { ThemeProvider } from './app/ThemeProvider.jsx';
import { WidthProvider } from './app/WidthProvider.jsx';
import { ToastProvider } from './app/ToastProvider.jsx';
import './styles/styles.css';
import './styles/sales-layout.css';
import './styles/brand-analytics.css';

ReactDOM.createRoot(document.getElementById('root')).render(
  <React.StrictMode>
    <HashRouter future={{ v7_startTransition: true, v7_relativeSplatPath: true }}>
      <ThemeProvider>
      <WidthProvider>
        <ToastProvider>
          <AuthProvider>
            <App />
          </AuthProvider>
        </ToastProvider>
        </WidthProvider>
    </ThemeProvider>
    </HashRouter>
  </React.StrictMode>
);
