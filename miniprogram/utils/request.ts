import { API_BASE_URL } from '../config';

export const request = <T>(options: WechatMiniprogram.RequestOption): Promise<T> => {
  return new Promise((resolve, reject) => {
    wx.request({
      ...options,
      url: `${API_BASE_URL}${options.url}`,
      success: (res) => {
        if (res.statusCode >= 200 && res.statusCode < 300) {
          resolve(res.data as T);
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
