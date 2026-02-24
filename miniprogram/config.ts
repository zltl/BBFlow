export const API_BASE_URL = 'https://bbflow.quant67.com/api';

// export const API_BASE_URL = 'http://localhost:3000/api';

export const DEFAULT_LIMITS = {
  DATA_ENTRIES: 30,
  OCR_TIMES: 5,
};

export const PAID_DAILY_LIMITS = {
  DATA_ENTRIES: 30,
  OCR_TIMES: 60,
};

export const API_ENDPOINTS = {
  OCR_RECOGNIZE: `/ocr/recognize`,
  AUTHORIZE: `/auth/authorize`,
  FEEDBACK: `/feedback`,
  USER_INFO: `/auth/me`,
  ADMIN_ACTIVATION_LINKS: `/admin/activation-links`,
  INVITE_CREATE: `/invite/create`,
  INVITE_LIST: `/invite/list`,
  INVITE_USE: `/invite/use`,
};
