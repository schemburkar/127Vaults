import { adminReady } from './admin-shell.mjs';
import { mountAccessDesk } from './access-desk.mjs';
const desk = mountAccessDesk(document);
adminReady.then(ready => { if (ready) return desk.select(new URLSearchParams(location.search).get('request')); }).catch(error => { document.getElementById('desk-status').textContent = error.message; });
