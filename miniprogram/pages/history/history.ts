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
      let records = res.data.map(item => {
        const dateObj = new Date(item.measured_at);
        const month = (dateObj.getMonth() + 1).toString().padStart(2, '0');
        const day = dateObj.getDate().toString().padStart(2, '0');
        const hour = dateObj.getHours().toString().padStart(2, '0');
        const minute = dateObj.getMinutes().toString().padStart(2, '0');
        const level = this.getHypertensionLevel(item.systolic, item.diastolic);

        let tags = [];
        try {
          tags = typeof item.tags === 'string' ? JSON.parse(item.tags) : item.tags;
        } catch (e) {
          tags = item.tags ? [item.tags] : [];
        }

        return {
          ...item,
          measuredAt: this.formatDateString(item.measured_at),
          dateStr: `${month}月${day}日`,
          timeStr: `${hour}:${minute}`,
          tags: tags,
          heartRate: item.heart_rate,
          hypertensionLevel: level
        };
      });

      if (this.data.filterDate) {
        records = records.filter(r => r.measuredAt.startsWith(this.data.filterDate));
      }

      const groupedRecords = this.groupRecordsByDate(records);
      this.setData({ records: groupedRecords });
    }).catch(err => {
      console.error('Failed to load records from server', err);
      // 降级到本地缓存
      this.loadLocalRecords();
    });
  },

  loadLocalRecords() {
    try {
      const allRecords = wx.getStorageSync('bp_records') || [];
      let displayRecords = allRecords.map((item: any) => {
        const level = this.getHypertensionLevel(item.systolic, item.diastolic);
        return { ...item, hypertensionLevel: level };
      });

      if (this.data.filterDate) {
        displayRecords = displayRecords.filter((r: any) => {
          return r.measuredAt.startsWith(this.data.filterDate);
        });
      }

      const groupedRecords = this.groupRecordsByDate(displayRecords);
      this.setData({
        records: groupedRecords
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

  getHypertensionLevel(systolic: number, diastolic: number) {
    if (systolic >= 180 || diastolic >= 110) return { level: 3, text: '三级高血压', color: '#ff4d4f' };
    if (systolic >= 160 || diastolic >= 100) return { level: 2, text: '二级高血压', color: '#ff7a45' };
    if (systolic >= 140 || diastolic >= 90) return { level: 1, text: '一级高血压', color: '#ffa940' };
    if (systolic >= 120 || diastolic >= 80) return { level: 0, text: '正常高值', color: '#faad14' };
    return { level: -1, text: '正常', color: '#52c41a' };
  },

  groupRecordsByDate(records: any[]) {
    const groups: any = {};
    records.forEach(record => {
      const dateKey = record.dateStr;
      if (!groups[dateKey]) {
        groups[dateKey] = [];
      }
      groups[dateKey].push(record);
    });
    return Object.keys(groups).map(key => ({
      date: key,
      records: groups[key]
    }));
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
