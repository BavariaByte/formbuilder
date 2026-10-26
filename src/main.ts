// Self-hosted variable fonts (GIRP corporate identity)
import '@fontsource-variable/inter/index.css';
import '@fontsource-variable/space-grotesk/index.css';
import '@fontsource-variable/jetbrains-mono/index.css';

import { createApp } from 'vue';
import App from './App.vue';
import { pinia } from './store';
import { initUiLocale } from '@/composables/useAppI18n';

// Create and mount the app
const app = createApp(App);

// Use Pinia for state management
app.use(pinia);
initUiLocale();

// Mount to DOM
app.mount('#app');
