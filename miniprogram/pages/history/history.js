Page({
  data: {
    records: [],
    filterDate: '',
    showDatePicker: false
  },

  onShow() {
    this.loadRecords();
  },

  // 加载记录
  loadRecords() {
    try {
      let records = wx.getStorageSync('bp_records') || [];
      
      // 如果有筛选日期，则过滤
      if (this.data.filterDate) {
        records = records.filter(record => {
          return record.measuredAt && record.measuredAt.startsWith(this.data.filterDate);
        });
      }
      
      // 计算血压状态供样式使用
      const enhanced = records.map(r => ({
        ...r,
        bpStatus: this.getBPStatus(r.systolic, r.diastolic)
      }));

      this.setData({
        records: enhanced
      });
    } catch (error) {
      wx.showToast({
        title: '加载失败',
        icon: 'none'
      });
    }
  },

  // 打开日期选择器
  showDateFilter() {
    this.setData({
      showDatePicker: true
    });
  },

  // 选择日期筛选
  onDateChange(e) {
    this.setData({
      filterDate: e.detail.value,
      showDatePicker: false
    }, () => {
      this.loadRecords();
    });
  },

  // 取消日期筛选
  cancelDateFilter() {
    this.setData({
      showDatePicker: false
    });
  },

  // 清除筛选
  clearFilter() {
    this.setData({
      filterDate: ''
    }, () => {
      this.loadRecords();
    });
  },

  // 查看记录详情
  viewDetail(e) {
    const index = e.currentTarget.dataset.index;
    const record = this.data.records[index];
    
    let content = `收缩压：${record.systolic} mmHg\n舒张压：${record.diastolic} mmHg\n心率：${record.heartRate} 次/分\n`;
    
    if (record.tags && record.tags.length > 0) {
      content += `标签：${record.tags.join('、')}\n`;
    }
    
    if (record.note) {
      content += `备注：${record.note}`;
    }
    
    wx.showModal({
      title: record.measuredAt,
      content: content,
      showCancel: false,
      confirmText: '关闭'
    });
  },

  // 删除记录
  deleteRecord(e) {
    const index = e.currentTarget.dataset.index;
    
    wx.showModal({
      title: '确认删除',
      content: '删除后无法恢复，确定要删除这条记录吗？',
      success: (res) => {
        if (res.confirm) {
          try {
            const records = wx.getStorageSync('bp_records') || [];
            records.splice(index, 1);
            wx.setStorageSync('bp_records', records);
            
            wx.showToast({
              title: '已删除',
              icon: 'success'
            });
            
            this.loadRecords();
          } catch (error) {
            wx.showToast({
              title: '删除失败',
              icon: 'none'
            });
          }
        }
      }
    });
  },

  // 判断血压状态
  getBPStatus(systolic, diastolic) {
    if (systolic >= 180 || diastolic >= 110) {
      return 'danger';
    } else if (systolic >= 140 || diastolic >= 90) {
      return 'warning';
    } else {
      return 'normal';
    }
  }
});
