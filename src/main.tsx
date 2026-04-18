import { createRoot } from 'react-dom/client';
import App from './App.tsx';
import './index.css';

// Suppress benign ResizeObserver loop warning (triggered by React Flow + dynamic node sizing)
const resizeObserverErr = window.onerror;
window.onerror = (message, ...args) => {
  if (typeof message === "string" && message.includes("ResizeObserver loop")) return true;
  return resizeObserverErr ? resizeObserverErr(message, ...args) : false;
};
window.addEventListener("error", (e) => {
  if (e.message?.includes("ResizeObserver loop")) {
    e.stopImmediatePropagation();
  }
});

createRoot(document.getElementById('root')!).render(<App />);
