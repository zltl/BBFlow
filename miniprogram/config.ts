export const API_BASE_URL = 'https://bbflow.quant67.com/api';

// export const API_BASE_URL = 'http://localhost:3000/api';

export const DEFAULT_LIMITS = {
  DATA_ENTRIES: 14,
  OCR_TIMES: 5,
};

export const AUTH_GRANTED_LIMITS = {
  DATA_ENTRIES: 10000,
  OCR_TIMES: 10000,
  DURATION_DAYS: 365,
};

export const API_ENDPOINTS = {
  OCR_RECOGNIZE: `/ocr/recognize`,
  AUTHORIZE: `/auth/authorize`,
  FEEDBACK: `/feedback`,
  USER_INFO: `/auth/me`,
  ADMIN_AUTH_CODES: `/admin/auth-codes`,
  BIND_REFERRER: `/auth/bind-referrer`,
};
