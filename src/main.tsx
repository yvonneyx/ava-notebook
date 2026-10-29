import '@fontsource/geist-mono/latin-400.css';
import { createRoot } from 'react-dom/client';
import App from './App';
import './style.css';

document.addEventListener('pointerdown', () => {
  document.documentElement.dataset.focusInput = 'pointer';
}, true);
document.addEventListener('keydown', (event) => {
  if (event.key === 'Tab' || event.key.startsWith('Arrow')) {
    delete document.documentElement.dataset.focusInput;
  }
}, true);

createRoot(document.getElementById('root')!).render(<App />);
