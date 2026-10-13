import { seedPreviewWorkspace } from './seed.js';

// Mount the real application, including its routing, copy and event handlers.
// The isolated entry adds only a fixture and an opt-in visual layer.
seedPreviewWorkspace();
document.documentElement.classList.add('ux-v2');
void import('../main.js').then(() => import('./prototype.css'));
