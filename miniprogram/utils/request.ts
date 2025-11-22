import { API_BASE_URL } from '../config';

export const request = <T>(options: WechatMiniprogram.RequestOption): Promise<T> => {
  const token = wx.getStorageSync('token');
  const header = {
    ...options.header,
    ...(token ? { 'Authorization': `Bearer ${token}` } : {})
  };

  return new Promise((resolve, reject) => {
    wx.request({
      ...options,
      url: `${API_BASE_URL}${options.url}`,
      header,
      success: (res) => {
        if (res.statusCode >= 200 && res.statusCode < 300) {
          resolve(res.data as T);
        } else if (res.statusCode === 401) {
          // Token expired or invalid
          wx.removeStorageSync('token');
          // Optional: Redirect to login or show toast
          console.error('Unauthorized, token removed');
          reject(res);
        } else if (res.statusCode === 429) {
          wx.showToast({
            title: '操作太频繁了，请稍后再试',
            icon: 'none',
            duration: 2000
          });
          reject(res);
        } else {
          console.error('Request failed:', res);
          reject(res);
        }
      },
      fail: (err) => {
        console.error('Network error:', err);
        reject(err);
      }
    });
  });
};
