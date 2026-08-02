import { API_ENDPOINTS } from '../../config';
import { request } from '../../utils/request';

interface ShareTokenSummary {
  token: string;
  access_count: number;
  is_revoked: boolean;
  expires_at: string;
}

Page({
  data: {
    isLoading: false,
    loadError: '',
    networkOffline: false,
    summary: {
      total: 0,
      active: 0,
      revoked: 0,
      access: 0,
    },
    recentLinks: [] as Array<ShareTokenSummary & { expiresAtText: string; statusLabel: string }>,
  },

  onShow() {
    this.loadSummary();
  },

  async loadSummary() {
    const offline = !!wx.getStorageSync('network_offline') && !wx.getStorageSync('token');
    this.setData({ isLoading: true, loadError: '', networkOffline: offline });
    if (offline) {
      this.setData({ isLoading: false, loadError: '网络不可用，请检查网络后重试' });
      return;
    }
    try {
      const res = await request<{ data: ShareTokenSummary[] }>({
        url: API_ENDPOINTS.SHARE_LIST,
        method: 'GET',
        showError: false,
      });

      const now = Date.now();
      const tokens = (res.data || []).map((item) => {
        const expiresAt = new Date(item.expires_at).getTime();
        return {
          ...item,
          expiresAtText: new Date(item.expires_at).toLocaleDateString(),
          statusLabel: item.is_revoked ? '已撤销' : expiresAt <= now ? '已过期' : '生效中',
        };
      });

      this.setData({
        summary: {
          total: tokens.length,
          active: tokens.filter((item) => item.statusLabel === '生效中').length,
          revoked: tokens.filter((item) => item.is_revoked).length,
          access: tokens.reduce((sum, item) => sum + (item.access_count || 0), 0),
        },
        recentLinks: tokens.slice(0, 3),
        loadError: '',
      });
    } catch (error) {
      console.error('Failed to load share center summary', error);
      this.setData({ loadError: '分享数据加载失败，点此重试' });
    } finally {
      this.setData({ isLoading: false });
    }
  },

  goToShareReport() {
    wx.navigateTo({ url: '/pages/share-table/share-table' });
  },

  goToCreateLink() {
    wx.navigateTo({ url: '/pages/share-link/share-link' });
  },

  goToManageLinks() {
    wx.navigateTo({ url: '/pages/share-manage/index' });
  },

  goToExportCenter() {
    wx.navigateTo({ url: '/pages/export-center/index' });
  },

  goToSubscription() {
    wx.navigateTo({ url: '/pages/subscription/index' });
  },
});
