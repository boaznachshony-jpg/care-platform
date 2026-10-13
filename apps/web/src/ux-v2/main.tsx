import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { CareDeskPrototype } from './CareDeskPrototype.js';
import './prototype.css';

const root = document.getElementById('root');
if (!root) throw new Error('Missing prototype root');
createRoot(root).render(
  <StrictMode>
    <CareDeskPrototype />
  </StrictMode>,
);
