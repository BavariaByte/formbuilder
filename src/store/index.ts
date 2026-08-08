// Pinia Store Setup
import { createPinia } from 'pinia';

export const pinia = createPinia();

// Export stores
export { useGraphStore } from './graph';
export { useValidationStore } from './validation';
export { useEditorStore } from './editor';
