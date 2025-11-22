import { request } from '../../utils/request';

Page({
  data: {
    isLoading: true,
    error: '',
    owner: null as any,
    records: [] as any[],
    meta: null as any
  },

  onLoad(options: any) {
    const token = options.token;
    if (token) {
      this.loadSharedData(token);
    } else {
      this.setData({ isLoading: false, error: '无效的分享链接' });
    }
  },

  async loadSharedData(token: string) {
    try {
      const res = await request<{ owner: any, records: any[], meta: any }>({
        url: `/share/view/${token}`,
        method: 'GET'
      });

      this.setData({
        owner: res.owner,
        records: res.records,
        meta: res.meta,
        isLoading: false
      });

    } catch (err: any) {
      console.error(err);
      let msg = '加载失败';
      if (err.statusCode === 404) msg = '链接无效或已失效';
      if (err.statusCode === 410) msg = '分享链接已过期';
      
      this.setData({
        isLoading: false,
        error: msg
      });
    }
  },

  onGoHome() {
    wx.reLaunch({ url: '/pages/record/record' });
  }
});
