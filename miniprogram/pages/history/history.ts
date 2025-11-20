import { request } from '../../utils/request';

Page({
  data: {
    records: [] as any[],
    filterDate: ''
  },

  onShow() {
    this.loadRecords();
  },

  onPullDownRefresh() {
    this.loadRecords();
    wx.stopPullDownRefresh();
  },

  loadRecords() {
    const openid = wx.getStorageSync('openid');
    if (!openid) {
      // 如果没有 openid，尝试从本地缓存读取（兼容离线模式或未登录状态）
      this.loadLocalRecords();
      return;
    }

    request<{ data: any[] }>({
      url: `/records?openid=${openid}`,
      method: 'GET'
    }).then(res => {
      let records = res.data.map(item => ({
        ...item,
        // 格式化时间，假设服务器返回的是 ISO 字符串
        measuredAt: this.formatDateString(item.measured_at),
        // 解析 tags，假设服务器返回的是 JSON 字符串
        tags: typeof item.tags === 'string' ? JSON.parse(item.tags) : item.tags,
        // 映射字段名以匹配页面绑定 (snake_case -> camelCase)
        heartRate: item.heart_rate
      }));

      if (this.data.filterDate) {
        records = records.filter(r => r.measuredAt.startsWith(this.data.filterDate));
      }

      this.setData({ records });
    }).catch(err => {
      console.error('Failed to load records from server', err);
      // 降级到本地缓存
      this.loadLocalRecords();
    });
  },

  loadLocalRecords() {
    try {
      const allRecords = wx.getStorageSync('bp_records') || [];
      let displayRecords = allRecords;

      if (this.data.filterDate) {
        displayRecords = allRecords.filter((r: any) => {
          return r.measuredAt.startsWith(this.data.filterDate);
        });
      }

      this.setData({
        records: displayRecords
      });
    } catch (e) {
      console.error('Failed to load local records', e);
    }
  },

  formatDateString(isoString: string) {
    if (!isoString) return '';
    const date = new Date(isoString);
    const year = date.getFullYear();
    const month = (date.getMonth() + 1).toString().padStart(2, '0');
    const day = date.getDate().toString().padStart(2, '0');
    const hour = date.getHours().toString().padStart(2, '0');
    const minute = date.getMinutes().toString().padStart(2, '0');
    return `${year}-${month}-${day} ${hour}:${minute}`;
  },

  onDateFilterChange(e: WechatMiniprogram.PickerChange) {
    this.setData({
      filterDate: e.detail.value as string
    }, () => {
      this.loadRecords();
    });
  },

  goToRecord() {
    wx.switchTab({
      url: '/pages/record/record'
    });
  },

  showDetail(e: WechatMiniprogram.TouchEvent) {
    const item = e.currentTarget.dataset.item;
    wx.showModal({
      title: '记录详情',
      content: `时间: ${item.measuredAt}\n高压: ${item.systolic}\n低压: ${item.diastolic}\n心率: ${item.heartRate}\n标签: ${item.tags ? item.tags.join(', ') : '无'}\n备注: ${item.note || '无'}`,
      showCancel: false
    });
  }
});
