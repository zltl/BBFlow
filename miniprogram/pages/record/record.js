Page({
  data: {
    systolic: '',
    diastolic: '',
    heartRate: '',
    measuredAt: '',
    tags: ['清晨空腹', '睡前', '运动后', '服药后', '感觉不适', '其他'],
    selectedTags: [],
    note: ''
  },

  onLoad() {
    // 初始化测量时间为当前时间
    const now = new Date();
    const datetime = this.formatDateTime(now);
    this.setData({
      measuredAt: datetime
    });
  },

  // 格式化日期时间
  formatDateTime(date) {
    const year = date.getFullYear();
    const month = String(date.getMonth() + 1).padStart(2, '0');
    const day = String(date.getDate()).padStart(2, '0');
    const hours = String(date.getHours()).padStart(2, '0');
    const minutes = String(date.getMinutes()).padStart(2, '0');
    return `${year}-${month}-${day} ${hours}:${minutes}`;
  },

  // 输入收缩压
  onSystolicInput(e) {
    this.setData({
      systolic: e.detail.value
    });
  },

  // 输入舒张压
  onDiastolicInput(e) {
    this.setData({
      diastolic: e.detail.value
    });
  },

  // 输入心率
  onHeartRateInput(e) {
    this.setData({
      heartRate: e.detail.value
    });
  },

  // 选择测量日期（自动补当前时间）
  onTimeChange(e) {
    const date = e.detail.value; // YYYY-MM-DD
    const now = new Date();
    const hours = String(now.getHours()).padStart(2, '0');
    const minutes = String(now.getMinutes()).padStart(2, '0');
    this.setData({
      measuredAt: `${date} ${hours}:${minutes}`
    });
  },

  // 切换标签选择
  toggleTag(e) {
    const tag = e.currentTarget.dataset.tag;
    const selectedTags = [...this.data.selectedTags];
    const index = selectedTags.indexOf(tag);
    
    if (index > -1) {
      selectedTags.splice(index, 1);
    } else {
      selectedTags.push(tag);
    }
    
    this.setData({
      selectedTags
    });
  },

  // 输入备注
  onNoteInput(e) {
    this.setData({
      note: e.detail.value
    });
  },

  // 校验数据
  validateData() {
    const { systolic, diastolic, heartRate } = this.data;
    
    if (!systolic || !diastolic || !heartRate) {
      wx.showToast({
        title: '请填写完整数据',
        icon: 'none'
      });
      return false;
    }

    // 必须为纯数字
    if (!/^\d+$/.test(systolic) || !/^\d+$/.test(diastolic) || !/^\d+$/.test(heartRate)) {
      wx.showToast({
        title: '请输入有效数字',
        icon: 'none'
      });
      return false;
    }

    const sys = Number(systolic);
    const dia = Number(diastolic);
    const hr = Number(heartRate);

    if ([sys, dia, hr].some(v => Number.isNaN(v))) {
      wx.showToast({
        title: '数值格式错误',
        icon: 'none'
      });
      return false;
    }

    let warnings = [];

    if (sys < 70 || sys > 260) {
      warnings.push('收缩压超出正常范围（70-260）');
    }

    if (dia < 40 || dia > 150) {
      warnings.push('舒张压超出正常范围（40-150）');
    }

    if (hr < 30 || hr > 200) {
      warnings.push('心率超出正常范围（30-200）');
    }

    if (warnings.length > 0) {
      return new Promise((resolve) => {
        wx.showModal({
          title: '数据异常',
          content: warnings.join('\n') + '\n\n是否继续保存？',
          success: (res) => {
            resolve(res.confirm);
          }
        });
      });
    }

    return true;
  },

  // 保存记录
  async handleSave() {
    const isValid = await this.validateData();
    if (!isValid) return;

    const record = {
      systolic: Number(this.data.systolic),
      diastolic: Number(this.data.diastolic),
      heartRate: Number(this.data.heartRate),
      measuredAt: this.data.measuredAt,
      tags: this.data.selectedTags,
      note: this.data.note,
      createdAt: new Date().toISOString(),
      source: 'manual'
    };

    try {
      // 从本地存储读取已有记录
      const records = wx.getStorageSync('bp_records') || [];
      records.unshift(record);
      
      // 保存到本地存储
      wx.setStorageSync('bp_records', records);

      wx.showToast({
        title: '记录成功',
        icon: 'success'
      });

      // 延迟后返回上一页
      setTimeout(() => {
        wx.navigateBack();
      }, 1500);
    } catch (error) {
      wx.showToast({
        title: '保存失败，请重试',
        icon: 'none'
      });
    }
  }
});
