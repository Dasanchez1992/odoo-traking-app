import React from 'react';
import ReactDOM from 'react-dom/client';
import App from './App';
import MiniTimer from './MiniTimer';
import './styles.css';

// La misma build sirve a la ventana principal y a la miniatura flotante.
const isWidget = new URLSearchParams(window.location.search).has('widget');

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>{isWidget ? <MiniTimer /> : <App />}</React.StrictMode>,
);
