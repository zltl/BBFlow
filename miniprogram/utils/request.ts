import { buildApiUrl, API_ENDPOINTS } from '../config';

interface RequestOptions extends WechatMiniprogram.RequestOption {
  url: string;
  skipAuth?: boolean;
  showError?: boolean;
  idempotencyKey?: string;
  /** Internal: already retried after re-login */
  _retried?: boolean;
}

let loginPromise: Promise<string | null> | null = null;

export const getRequestErrorMessage = (res: Partial<WechatMiniprogram.RequestSuccessCallbackResult<any>> & { message?: string }) => {
  const data = res.data as Record<string, any> | undefined;
  if (res.message) return res.message;
  if (data?.message) return data.message;
  if (data?.error) return data.error;
  if (res.statusCode === 401) return '登录已失效，正在重新登录';
  if (res.statusCode === 403) return '当前没有权限执行此操作';
  if (res.statusCode === 404) return '请求资源不存在';
  if (res.statusCode === 429) return '操作太频繁了，请稍后再试';
  return '请求失败，请稍后重试';
};

/** Perform wx.login + backend exchange; returns new token or null */
export const ensureLogin = (): Promise<string | null> => {
  if (loginPromise) return loginPromise;

  loginPromise = new Promise((resolve) => {
    wx.login({
      success: (loginRes) => {
        if (!loginRes.code) {
          resolve(null);
          return;
        }
        wx.request({
          url: buildApiUrl(API_ENDPOINTS.AUTH_LOGIN),
          method: 'POST',
          data: { code: loginRes.code },
          success: (res) => {
            if (res.statusCode >= 200 && res.statusCode < 300) {
              const data = res.data as { openid?: string; token?: string };
              if (data.openid) wx.setStorageSync('openid', data.openid);
              if (data.token) {
                wx.setStorageSync('token', data.token);
                wx.removeStorageSync('network_offline');
                resolve(data.token);
                return;
              }
            }
            resolve(null);
          },
          fail: () => resolve(null),
        });
      },
      fail: () => resolve(null),
      complete: () => {
        loginPromise = null;
      },
    });
  });

  return loginPromise;
};

export const request = <T>(options: RequestOptions): Promise<T> => {
  const token = wx.getStorageSync('token');
  const header = {
    ...options.header,
    ...(!options.skipAuth && token ? { Authorization: `Bearer ${token}` } : {}),
    ...(options.idempotencyKey ? { 'Idempotency-Key': options.idempotencyKey } : {}),
  };

  return new Promise((resolve, reject) => {
    wx.request({
      ...options,
      url: buildApiUrl(options.url),
      header,
      success: async (res) => {
        if (res.statusCode >= 200 && res.statusCode < 300) {
          resolve(res.data as T);
          return;
        }

        // Expired/invalid token: clear, re-login once, retry
        if ((res.statusCode === 401 || res.statusCode === 403) && !options.skipAuth && !options._retried) {
          const errMsg = (res.data as any)?.error || '';
          const looksLikeAuth =
            res.statusCode === 401 ||
            /token|unauthorized|expired|access token/i.test(String(errMsg));

          if (looksLikeAuth) {
            wx.removeStorageSync('token');
            const newToken = await ensureLogin();
            if (newToken) {
              try {
                const retryResult = await request<T>({ ...options, _retried: true });
                resolve(retryResult);
                return;
              } catch (retryErr) {
                reject(retryErr);
                return;
              }
            }
            if (options.showError !== false) {
              wx.showToast({ title: '登录失败，请检查网络后重试', icon: 'none', duration: 2500 });
            }
            reject({ ...res, message: '登录失败，请检查网络后重试' });
            return;
          }
        }

        const message = getRequestErrorMessage(res);
        console.error('Request failed:', res);
        if (options.showError !== false) {
          wx.showToast({
            title: message,
            icon: 'none',
            duration: 2500,
          });
        }
        reject({ ...res, message });
      },
      fail: (err) => {
        console.error('Network error:', err);
        if (options.showError !== false) {
          wx.showToast({
            title: '网络异常，请稍后重试',
            icon: 'none',
            duration: 2500,
          });
        }
        reject(err);
      },
    });
  });
};
