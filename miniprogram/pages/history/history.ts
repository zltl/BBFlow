import { API_ENDPOINTS } from '../../config';
import { request } from '../../utils/request';

Page({
  data: {
    records: [] as any[],
    filterDate: '',
    isLoading: false,
    hasMore: true,
    autoAverage: true
  },

  // Pagination state
  _allRecords: [] as any[],
  _pageSize: 20,
  _currentPage: 1,

  onShow() {
    const storageValue = wx.getStorageSync('autoAverage');
    const autoAverage = storageValue === '' ? true : storageValue;
    this.setData({ autoAverage });
    this.loadRecords();
  },

  onPullDownRefresh() {
    this.loadRecords();
    wx.stopPullDownRefresh();
  },

  onReachBottom() {
    if (this.data.hasMore && !this.data.isLoading) {
      this.loadMoreRecords();
    }
  },

  toggleAutoAverage() {
    const newValue = !this.data.autoAverage;
    this.setData({ autoAverage: newValue });
    wx.setStorageSync('autoAverage', newValue);
    this.loadRecords();
  },

  mergeRecordsByTimeWindow(records: any[], windowHours: number = 2): any[] {
    if (!this.data.autoAverage || records.length === 0) return records;

    const windowMs = windowHours * 60 * 60 * 1000;
    const merged: any[] = [];
    let currentGroup: any[] = [];

    records.forEach((record, index) => {
      if (currentGroup.length === 0) {
        currentGroup.push(record);
      } else {
        const lastTime = new Date(currentGroup[0].measured_at).getTime();
        const currentTime = new Date(record.measured_at).getTime();
        
        if (Math.abs(currentTime - lastTime) <= windowMs) {
          currentGroup.push(record);
        } else {
          merged.push(this.averageGroup(currentGroup));
          currentGroup = [record];
        }
      }

      if (index === records.length - 1 && currentGroup.length > 0) {
        merged.push(this.averageGroup(currentGroup));
      }
    });

    return merged;
  },

  averageGroup(group: any[]): any {
    if (group.length === 1) return group[0];

    const avgSystolic = Math.round(group.reduce((sum, r) => sum + r.systolic, 0) / group.length);
    const avgDiastolic = Math.round(group.reduce((sum, r) => sum + r.diastolic, 0) / group.length);
    const avgHeartRate = Math.round(group.reduce((sum, r) => sum + (r.heart_rate || 0), 0) / group.length);

    const allTags = Array.from(new Set(group.flatMap(r => r.tags || [])));
    const notes = group.map(r => r.note).filter(n => n).join('; ');

    return {
      ...group[0],
      systolic: avgSystolic,
      diastolic: avgDiastolic,
      heart_rate: avgHeartRate,
      tags: allTags,
      note: notes || group[0].note,
      _mergedCount: group.length,
      _originalRecords: group
    };
  },

  loadRecords() {
    const openid = wx.getStorageSync('openid');
    if (!openid) {
      this.loadLocalRecords();
      return;
    }

    this.setData({ isLoading: true });

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

      // Apply auto-average if enabled
      records = this.mergeRecordsByTimeWindow(records, 2);

      // Store all processed records
      this._allRecords = records;
      this._currentPage = 1;
      
      // Initial render
      this.renderPage(1);

    }).catch(err => {
      console.error('Failed to load records from server', err);
      this.loadLocalRecords();
    }).finally(() => {
      this.setData({ isLoading: false });
    });
  },

  loadMoreRecords() {
    this.setData({ isLoading: true });
    
    // Simulate async delay for smoother UX
    setTimeout(() => {
      this._currentPage++;
      this.renderPage(this._currentPage);
      this.setData({ isLoading: false });
    }, 300);
  },

  renderPage(page: number) {
    const pageSize = this._pageSize;
    const totalRecords = this._allRecords.length;
    const endIndex = page * pageSize;
    
    const currentSlice = this._allRecords.slice(0, endIndex);
    const groupedRecords = this.groupRecordsByDate(currentSlice);
    
    this.setData({
      records: groupedRecords,
      hasMore: endIndex < totalRecords
    });
  },

  loadLocalRecords() {
    try {
      const allRecords = wx.getStorageSync('bp_records') || [];
      // Sort by measuredAt desc
      allRecords.sort((a: any, b: any) => new Date(b.measuredAt).getTime() - new Date(a.measuredAt).getTime());

      let displayRecords = allRecords.map((item: any) => {
        const level = this.getHypertensionLevel(item.systolic, item.diastolic);
        
        // Format Date and Time
        const dateObj = new Date(item.measuredAt);
        const dateStr = `${dateObj.getFullYear()}-${(dateObj.getMonth() + 1).toString().padStart(2, '0')}-${dateObj.getDate().toString().padStart(2, '0')}`;
        const timeStr = `${dateObj.getHours().toString().padStart(2, '0')}:${dateObj.getMinutes().toString().padStart(2, '0')}`;
        
        // Parse tags if string
        let tags = item.tags;
        if (typeof tags === 'string') {
            try {
                tags = JSON.parse(tags);
            } catch (e) {
                tags = [];
            }
        }

        return { 
            ...item, 
            hypertensionLevel: level,
            dateStr,
            timeStr,
            tags: Array.isArray(tags) ? tags : []
        };
      });

      if (this.data.filterDate) {
        displayRecords = displayRecords.filter((r: any) => {
          return r.measuredAt.startsWith(this.data.filterDate);
        });
      }

      // Store all processed records
      this._allRecords = displayRecords;
      this._currentPage = 1;
      this.renderPage(1);
      
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
    let level = -1;
    let text = '正常';
    let color = '#52c41a';
    let detail = '';

    if (systolic >= 180 || diastolic >= 110) {
        level = 3; text = '三级高血压'; color = '#ff4d4f';
    } else if (systolic >= 160 || diastolic >= 100) {
        level = 2; text = '二级高血压'; color = '#ff7a45';
    } else if (systolic >= 140 || diastolic >= 90) {
        level = 1; text = '一级高血压'; color = '#ffa940';
    } else if (systolic >= 120 || diastolic >= 80) {
        level = 0; text = '正常高值'; color = '#faad14';
    }

    // Generate detail text for warning
    if (level >= 1) {
        const sysHigh = systolic >= 140;
        const diaHigh = diastolic >= 90;
        if (sysHigh && diaHigh) {
            detail = '收缩压与舒张压均偏高';
        } else if (sysHigh) {
            detail = '收缩压偏高，舒张压正常';
        } else if (diaHigh) {
            detail = '舒张压偏高，收缩压正常';
        }
    }

    return { level, text, color, detail };
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
    return Object.keys(groups).sort((a, b) => new Date(b).getTime() - new Date(a).getTime()).map(key => ({
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
    wx.showActionSheet({
      itemList: ['查看详情', '编辑记录', '删除记录'],
      success: (res) => {
        if (res.tapIndex === 0) {
          wx.showModal({
            title: '记录详情',
            content: `时间: ${item.measuredAt}\n高压: ${item.systolic}\n低压: ${item.diastolic}\n心率: ${item.heartRate}\n标签: ${item.tags ? item.tags.join(', ') : '无'}\n备注: ${item.note || '无'}`,
            showCancel: false,
          });
        } else if (res.tapIndex === 1) {
          wx.setStorageSync('pending_edit_record_id', item.id);
          wx.switchTab({ url: '/pages/record/record' });
        } else if (res.tapIndex === 2) {
          this.deleteRecord(item.id);
        }
      },
    });
  },

  async deleteRecord(id: number) {
    if (!id) return;
    const confirm = await new Promise<boolean>((resolve) => {
      wx.showModal({
        title: '删除记录',
        content: '确认删除这条血压记录吗？',
        confirmColor: '#ff4d4f',
        success: (res) => resolve(!!res.confirm),
      });
    });
    if (!confirm) return;
    try {
      await request({
        url: `${API_ENDPOINTS.RECORDS}/${id}`,
        method: 'DELETE',
      });
      wx.showToast({ title: '已删除', icon: 'success' });
      this.loadRecords();
    } catch (error) {
      console.error('Failed to delete record', error);
    }
  },
});
