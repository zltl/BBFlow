import { API_ENDPOINTS } from '../../config';
import { downloadFile } from '../../utils/download';
import { request } from '../../utils/request';

Page({
  data: {
    exportingJson: false,
    exportingCsv: false,
    deletingAccount: false,
  },

  async exportJson() {
    this.setData({ exportingJson: true });
    try {
      const filePath = await downloadFile({
        url: API_ENDPOINTS.EXPORT_JSON,
        showLoadingTitle: '导出 JSON 中...',
      });
      this.handleFile(filePath);
    } catch (error) {
      console.error('Failed to export json', error);
    } finally {
      this.setData({ exportingJson: false });
    }
  },

  async exportCsv() {
    this.setData({ exportingCsv: true });
    try {
      const filePath = await downloadFile({
        url: API_ENDPOINTS.EXPORT_CSV,
        showLoadingTitle: '导出 CSV 中...',
        openDocument: true,
      });
      this.handleFile(filePath);
    } catch (error) {
      console.error('Failed to export csv', error);
    } finally {
      this.setData({ exportingCsv: false });
    }
  },

  handleFile(filePath: string) {
    const canShare = wx.canIUse('shareFileMessage');
    if (canShare) {
      wx.shareFileMessage({
        filePath,
        success: () => wx.showToast({ title: '文件已就绪', icon: 'success' }),
        fail: () => this.saveFile(filePath),
      });
      return;
    }
    this.saveFile(filePath);
  },

  saveFile(filePath: string) {
    wx.saveFile({
      tempFilePath: filePath,
      success: () => wx.showToast({ title: '文件已保存', icon: 'success' }),
      fail: () => wx.showToast({ title: '文件已下载，可继续转发', icon: 'none' }),
    });
  },

  deleteAccount() {
    wx.showModal({
      title: '删除账号',
      content: '删除后将清空血压记录、OCR 历史、分享链接、用药数据和工单记录，此操作不可恢复。',
      confirmText: '继续删除',
      confirmColor: '#ff4d4f',
      success: (firstConfirm) => {
        if (!firstConfirm.confirm) return;
        wx.showModal({
          title: '请再次确认',
          content: '确定永久删除当前账号和全部数据吗？',
          confirmText: '确认删除',
          confirmColor: '#ff4d4f',
          success: async (secondConfirm) => {
            if (!secondConfirm.confirm) return;
            this.setData({ deletingAccount: true });
            try {
              const res = await request<{ message: string }>({
                url: API_ENDPOINTS.DELETE_ACCOUNT,
                method: 'DELETE',
              });
              wx.clearStorageSync();
              wx.showModal({
                title: '已删除',
                content: res.message || '账号已删除',
                showCancel: false,
                success: () => wx.reLaunch({ url: '/pages/record/record' }),
              });
            } catch (error) {
              console.error('Failed to delete account', error);
            } finally {
              this.setData({ deletingAccount: false });
            }
          },
        });
      },
    });
  },
});
