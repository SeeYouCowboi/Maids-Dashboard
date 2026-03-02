import React from 'react';
import ReactDOM from 'react-dom/client';
import './index.css';
import App from './App';
import { ConfirmSecretProvider } from './contexts/ConfirmSecretContext';

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <ConfirmSecretProvider>
      <App />
    </ConfirmSecretProvider>
  </React.StrictMode>,
);
