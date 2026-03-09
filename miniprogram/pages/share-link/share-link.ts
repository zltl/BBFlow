import { request } from '../../utils/request';
import { API_BASE_ORIGIN, API_ENDPOINTS } from '../../config';

Page({
  data: {
    timeRange: '7', // '7', '30', 'all'
    shareFutureData: false,
    shareLink: '',
    httpLink: '',
    expirationTime: '',
    isLoading: false
  },

  onRangeChange(e: WechatMiniprogram.RadioGroupChange) {
    this.setData({
      timeRange: e.detail.value
    });
  },

  onFutureDataChange(e: WechatMiniprogram.SwitchChange) {
    this.setData({
      shareFutureData: e.detail.value
    });
  },

  async generateLink() {
    this.setData({ isLoading: true });

    try {
      const res = await request<{ token: string, expiration: string }>({
        url: API_ENDPOINTS.SHARE_GENERATE_TOKEN,
        method: 'POST',
        data: {
          timeRange: this.data.timeRange,
          shareFutureData: this.data.shareFutureData
        }
      });

      // Assuming the H5 page is hosted at a specific URL
      // In a real scenario, this would be your H5 domain
      // For now, we can simulate a link or use a cloud function URL if available
      // Or simply share the token which the recipient can use to view data
      
      // Construct a shareable path for the mini program itself (to open a viewer page)
      // Or an external H5 link
      
      // Let's assume we share a Mini Program Page that acts as the viewer
      // path: /pages/viewer/viewer?token=...
      
      // Remove /api from base url for the HTML view link
      const httpLink = `${API_BASE_ORIGIN}/share/html/${res.token}`;

      this.setData({
        shareLink: res.token, // Store token to use in onShareAppMessage
        httpLink,
        expirationTime: res.expiration
      });

      wx.showToast({
        title: '链接生成成功',
        icon: 'success'
      });

    } catch (err) {
      console.error(err);
      wx.showToast({
        title: '生成失败',
        icon: 'none'
      });
    } finally {
      this.setData({ isLoading: false });
    }
  },

  copyLink() {
    if (!this.data.httpLink) return;
    wx.setClipboardData({
      data: this.data.httpLink,
      success: () => {
        wx.showToast({
          title: '链接已复制',
          icon: 'success'
        });
      }
    });
  },

  goToManageLinks() {
    wx.navigateTo({ url: '/pages/share-manage/index' });
  },

  onShareAppMessage() {
    const token = this.data.shareLink;
    if (!token) {
      return {
        title: '安压宝 - 血压健康管理',
        path: '/pages/share/share'
      };
    }

    return {
      title: '我的血压数据分享',
      path: `/pages/viewer/viewer?token=${token}`,
      imageUrl: '/assets/share-cover.png' // Optional: Add a cover image
    };
  }
});
