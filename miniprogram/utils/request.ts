import { buildApiUrl } from '../config';

interface RequestOptions extends WechatMiniprogram.RequestOption {
  url: string;
  skipAuth?: boolean;
  showError?: boolean;
  idempotencyKey?: string;
}

export const getRequestErrorMessage = (res: Partial<WechatMiniprogram.RequestSuccessCallbackResult<any>> & { message?: string }) => {
  const data = res.data as Record<string, any> | undefined;
  if (res.message) return res.message;
  if (data?.message) return data.message;
  if (data?.error) return data.error;
  if (res.statusCode === 401) return '登录已失效，请重新进入小程序';
  if (res.statusCode === 403) return '当前没有权限执行此操作';
  if (res.statusCode === 404) return '请求资源不存在';
  if (res.statusCode === 429) return '操作太频繁了，请稍后再试';
  return '请求失败，请稍后重试';
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
      success: (res) => {
        if (res.statusCode >= 200 && res.statusCode < 300) {
          resolve(res.data as T);
        } else if (res.statusCode === 401) {
          // Token expired or invalid
          wx.removeStorageSync('token');
          // Optional: Redirect to login or show toast
        } else {
          const message = getRequestErrorMessage(res);
          console.error('Request failed:', res);
          if (options.showError !== false) {
            wx.showToast({
              title: message,
              icon: 'none',
              duration: 2500
            });
          }
          reject({ ...res, message });
        }
      },
      fail: (err) => {
        console.error('Network error:', err);
        if (options.showError !== false) {
          wx.showToast({
            title: '网络异常，请稍后重试',
            icon: 'none',
            duration: 2500
          });
        }
        reject(err);
      }
    });
  });
};
