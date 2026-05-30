import axios from 'axios';

const BASE = import.meta.env.VITE_API_URL || '/api';

const api = axios.create({ baseURL: BASE, withCredentials: true });

export const appLogin = (secret) => api.post('/auth/app-login', { secret }).then(r => r.data);
export const appLogout = () => api.post('/auth/app-logout').then(r => r.data);

export const getAuthStatus = () => api.get('/auth/status').then(r => r.data);
export const saveCredentials = (email, password) => api.post('/auth/credentials', { email, password }).then(r => r.data);

export const getVehicleStatus = () => api.get('/status').then(r => r.data);
export const getPrices = () => api.get('/prices').then(r => r.data);
export const getSchedule = () => api.get('/schedule').then(r => r.data);
export const recalculateSchedule = () => api.post('/schedule/recalculate').then(r => r.data);

export const getConfig = () => api.get('/config').then(r => r.data);
export const updateConfig = (data) => api.post('/config', data).then(r => r.data);

export const startCharging = () => api.post('/charge/start').then(r => r.data);
export const stopCharging = () => api.post('/charge/stop').then(r => r.data);
export const setChargeLimit = (percent) => api.post('/charge/limit', { percent }).then(r => r.data);
export const setChargingAmps = (amps) => api.post('/charge/amps', { amps }).then(r => r.data);

export const climateStart = (temp) => api.post('/climate/start', { temp }).then(r => r.data);
export const climateStop = () => api.post('/climate/stop').then(r => r.data);

export const setSentryMode = (on) => api.post('/sentry', { on }).then(r => r.data);
export const setSeatHeater = (heater, level) => api.post('/seat-heater', { heater, level }).then(r => r.data);

export const getHistory = (limit = 50) => api.get(`/history?limit=${limit}`).then(r => r.data);
export const testNotification = () => api.post('/notify/test').then(r => r.data);
export const refreshPrices = () => api.post('/prices/refresh').then(r => r.data);
export const wakeUp = () => api.post('/wake').then(r => r.data);

export default api;
