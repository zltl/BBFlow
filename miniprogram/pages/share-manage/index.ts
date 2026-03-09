import { API_BASE_ORIGIN, API_ENDPOINTS } from '../../config';
import { request } from '../../utils/request';

interface ShareTokenItem {
  token: string;
  time_range: string;
  share_future_data: boolean;
  expires_at: string;
  created_at: string;
  is_revoked: boolean;
  access_count: number;
  last_accessed_at?: string | null;
  statusLabel?: string;
  statusTone?: 'active' | 'warning' | 'muted';
  createdAtText?: string;
  expiresAtText?: string;
  lastAccessedText?: string;
}

Page({
  data: {
    isLoading: false,
    tokens: [] as ShareTokenItem[],
    activeCount: 0,
    revokedCount: 0,
    totalAccessCount: 0,
  },

  onShow() {
    this.loadTokens();
  },

  async loadTokens() {
    this.setData({ isLoading: true });
    try {
      const res = await request<{ data: ShareTokenItem[] }>({
        url: API_ENDPOINTS.SHARE_LIST,
        method: 'GET',
        showError: false,
      });

      const now = Date.now();
      const tokens = (res.data || []).map((item) => {
        const expiresAt = new Date(item.expires_at).getTime();
        let statusLabel = '生效中';
        let statusTone: ShareTokenItem['statusTone'] = 'active';

        if (item.is_revoked) {
          statusLabel = '已撤销';
          statusTone = 'muted';
        } else if (expiresAt <= now) {
          statusLabel = '已过期';
          statusTone = 'warning';
        }

        return {
          ...item,
          statusLabel,
          statusTone,
          createdAtText: this.formatTime(item.created_at),
          expiresAtText: this.formatTime(item.expires_at),
          lastAccessedText: this.formatTime(item.last_accessed_at),
        };
      });

      this.setData({
        tokens,
        activeCount: tokens.filter((item) => item.statusTone === 'active').length,
        revokedCount: tokens.filter((item) => item.is_revoked).length,
        totalAccessCount: tokens.reduce((sum, item) => sum + (item.access_count || 0), 0),
      });
    } catch (error) {
      console.error('Failed to load share tokens', error);
    } finally {
      this.setData({ isLoading: false });
    }
  },

  copyLink(e: WechatMiniprogram.TouchEvent) {
    const token = e.currentTarget.dataset.token;
    if (!token) return;

    wx.setClipboardData({
      data: `${API_BASE_ORIGIN}/share/html/${token}`,
      success: () => wx.showToast({ title: '链接已复制', icon: 'success' }),
    });
  },

  revokeToken(e: WechatMiniprogram.TouchEvent) {
    const token = e.currentTarget.dataset.token;
    if (!token) return;

    wx.showModal({
      title: '撤销分享链接',
      content: '撤销后，已发出的链接将立即失效，确认继续吗？',
      confirmColor: '#ff4d4f',
      success: async (res) => {
        if (!res.confirm) return;

        try {
          await request({
            url: `${API_ENDPOINTS.SHARE_REVOKE_PREFIX}/${token}`,
            method: 'POST',
          });
          wx.showToast({ title: '已撤销', icon: 'success' });
          this.loadTokens();
        } catch (error) {
          console.error('Failed to revoke token', error);
        }
      },
    });
  },

  goCreateLink() {
    wx.navigateTo({ url: '/pages/share-link/share-link' });
  },

  formatTime(value?: string | null) {
    if (!value) return '暂无';
    const date = new Date(value);
    const month = `${date.getMonth() + 1}`.padStart(2, '0');
    const day = `${date.getDate()}`.padStart(2, '0');
    const hour = `${date.getHours()}`.padStart(2, '0');
    const minute = `${date.getMinutes()}`.padStart(2, '0');
    return `${month}-${day} ${hour}:${minute}`;
  },
});
