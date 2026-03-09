import { buildApiUrl } from '../config';

interface DownloadOptions {
  url: string;
  showLoadingTitle?: string;
  openDocument?: boolean;
}

export const downloadFile = (options: DownloadOptions): Promise<string> => {
  const token = wx.getStorageSync('token');

  return new Promise((resolve, reject) => {
    if (options.showLoadingTitle) {
      wx.showLoading({ title: options.showLoadingTitle });
    }

    wx.downloadFile({
      url: buildApiUrl(options.url),
      header: token ? { Authorization: `Bearer ${token}` } : undefined,
      success: (res) => {
        if (options.showLoadingTitle) {
          wx.hideLoading();
        }

        if (res.statusCode >= 200 && res.statusCode < 300 && res.tempFilePath) {
          if (options.openDocument) {
            wx.openDocument({
              filePath: res.tempFilePath,
              showMenu: true,
              fail: () => resolve(res.tempFilePath),
              success: () => resolve(res.tempFilePath),
            });
            return;
          }
          resolve(res.tempFilePath);
          return;
        }

        wx.showToast({ title: '下载失败，请稍后重试', icon: 'none', duration: 2500 });
        reject(res);
      },
      fail: (error) => {
        if (options.showLoadingTitle) {
          wx.hideLoading();
        }
        wx.showToast({ title: '下载失败，请检查网络', icon: 'none', duration: 2500 });
        reject(error);
      },
    });
  });
};
