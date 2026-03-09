export const API_BASE_URL = 'https://bbflow.quant67.com/api';

// export const API_BASE_URL = 'http://localhost:3000/api';

export const API_BASE_ORIGIN = API_BASE_URL.replace(/\/api$/, '');

export const buildApiUrl = (path: string) => {
  if (!path) return API_BASE_URL;
  if (/^https?:\/\//.test(path)) return path;
  return `${API_BASE_URL}${path.startsWith('/') ? path : `/${path}`}`;
};

export const DEFAULT_LIMITS = {
  DATA_ENTRIES: 30,  // per day
  OCR_TIMES: 5,      // per month
};

export const PAID_DAILY_LIMITS = {
  DATA_ENTRIES: 30,
  OCR_TIMES: 60,
};

export const ADMIN_DAILY_LIMITS = {
  DATA_ENTRIES: 100,
  OCR_TIMES: 1000,
};

export const API_ENDPOINTS = {
  AUTH_LOGIN: `/auth/login`,
  OCR_RECOGNIZE: `/ocr/recognize`,
  OCR_VERIFY: `/ocr/verify`,
  AUTHORIZE: `/auth/authorize`,
  FEEDBACK: `/feedback`,
  USER_INFO: `/auth/me`,
  ADMIN_ACTIVATION_LINKS: `/admin/activation-links`,
  ADMIN_TICKETS: `/admin/tickets`,
  ADMIN_USER_SEARCH: `/admin/users/search`,
  ADMIN_ANALYTICS: `/admin/analytics`,
  INVITE_CREATE: `/invite/create`,
  INVITE_LIST: `/invite/list`,
  INVITE_USE: `/invite/use`,
  RECORDS: `/records`,
  INSIGHTS: `/insights`,
  MEDICATIONS: `/medications`,
  MEDICATION_LOG: `/medications/log`,
  MEDICATION_ADHERENCE: `/medications/adherence`,
  SHARE_GENERATE_TOKEN: `/share/generate-token`,
  SHARE_LIST: `/share/list`,
  SHARE_REVOKE_PREFIX: `/share/revoke`,
  EXPORT_JSON: `/export/json`,
  EXPORT_CSV: `/export/csv`,
  DELETE_ACCOUNT: `/account`,
  PLANS: `/plans`,
  PAYMENT_ORDER: `/payment/order`,
  PAYMENT_SUBSCRIPTION: `/payment/subscription`,
  PAYMENT_ORDERS: `/payment/orders`,
  TICKETS: `/tickets`,
};
