import { buildApiUrl } from '../config';

interface UploadOptions {
  url: string;
  filePath: string;
  name: string;
  formData?: Record<string, string | number | boolean>;
  header?: Record<string, string>;
  skipAuth?: boolean;
  showError?: boolean;
}

const normalizeError = (statusCode: number, body: any) => {
  if (body?.message) return body.message;
  if (body?.error) return body.error;
  if (statusCode === 401) return '登录已失效，请重试';
  if (statusCode === 403) return '暂无权限执行此操作';
  if (statusCode === 404) return '请求资源不存在';
  if (statusCode === 429) return '操作太频繁了，请稍后再试';
  return '上传失败，请稍后重试';
};

export const uploadFile = <T>(options: UploadOptions): Promise<T> => {
  const token = wx.getStorageSync('token');
  const header = {
    ...options.header,
    ...(!options.skipAuth && token ? { Authorization: `Bearer ${token}` } : {}),
  };

  return new Promise((resolve, reject) => {
    wx.uploadFile({
      url: buildApiUrl(options.url),
      filePath: options.filePath,
      name: options.name,
      formData: options.formData,
      header,
      success: (res) => {
        let body: any = {};
        try {
          body = res.data ? JSON.parse(res.data) : {};
        } catch (error) {
          reject(error);
          return;
        }

        if (res.statusCode >= 200 && res.statusCode < 300) {
          resolve(body as T);
          return;
        }

        const message = normalizeError(res.statusCode, body);
        if (options.showError !== false) {
          wx.showToast({ title: message, icon: 'none', duration: 2500 });
        }
        reject({ ...res, data: body, message });
      },
      fail: (error) => {
        if (options.showError !== false) {
          wx.showToast({ title: '上传失败，请检查网络', icon: 'none', duration: 2500 });
        }
        reject(error);
      },
    });
  });
};
