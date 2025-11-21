import { request } from '../../utils/request';
import { API_ENDPOINTS } from '../../config';

Page({
  data: {
    date: '',
    time: '',
    tags: ['清晨空腹', '睡前', '运动后', '服药后', '感觉不适', '其他'],
    selectedTags: {} as Record<string, boolean>,
    systolic: '',
    diastolic: '',
    heartRate: '',
    note: '',
    ocrLogId: null as number | null
  },

  onLoad() {
    this.checkFirstUse();
    const now = new Date();
    const year = now.getFullYear();
    const month = (now.getMonth() + 1).toString().padStart(2, '0');
    const day = now.getDate().toString().padStart(2, '0');
    const hour = now.getHours().toString().padStart(2, '0');
    const minute = now.getMinutes().toString().padStart(2, '0');

    this.setData({
      date: `${year}-${month}-${day}`,
      time: `${hour}:${minute}`
    });
  },

  checkFirstUse() {
    const hasShownGuide = wx.getStorageSync('has_shown_guide');
    if (!hasShownGuide) {
      wx.showModal({
        title: '欢迎使用安压宝',
        content: '本工具仅用于记录和管理血压数据，不提供医疗诊断建议。如有不适，请及时就医。\n\n核心功能：\n1. 记录血压：手动录入或拍照记录\n2. 历史趋势：查看过往记录',
        showCancel: false,
        confirmText: '我知道了',
        success: () => {
          wx.setStorageSync('has_shown_guide', true);
        }
      });
    }
  },

  bindDateChange(e: WechatMiniprogram.PickerChange) {
    this.setData({
      date: e.detail.value as string
    });
  },

  bindTimeChange(e: WechatMiniprogram.PickerChange) {
    this.setData({
      time: e.detail.value as string
    });
  },

  toggleTag(e: WechatMiniprogram.TouchEvent) {
    const tag = e.currentTarget.dataset.tag;
    const selectedTags = this.data.selectedTags;
    // Toggle
    if (selectedTags[tag]) {
      delete selectedTags[tag];
    } else {
      selectedTags[tag] = true;
    }
    this.setData({
      selectedTags
    });
  },

  onOCRScan() {
    const that = this;
    wx.chooseMedia({
      count: 1,
      mediaType: ['image'],
      sourceType: ['camera', 'album'],
      sizeType: ['compressed'],
      success(res) {
        const tempFilePath = res.tempFiles[0].tempFilePath;
        
        wx.showLoading({
          title: '识别中...',
        });

        wx.uploadFile({
          url: API_ENDPOINTS.OCR_RECOGNIZE,
          filePath: tempFilePath,
          name: 'image',
          success(uploadRes) {
            wx.hideLoading();
            try {
              const data = JSON.parse(uploadRes.data);
              if (data.success && data.data) {
                const { systolic, diastolic, heartRate } = data.data;
                
                if (!systolic && !diastolic && !heartRate) {
                   wx.showToast({ title: '未能识别有效读数', icon: 'none' });
                   return;
                }

                that.setData({
                  systolic: systolic ? systolic.toString() : '',
                  diastolic: diastolic ? diastolic.toString() : '',
                  heartRate: heartRate ? heartRate.toString() : '',
                  ocrLogId: data.ocrLogId || null
                });
                
                wx.showToast({
                  title: '识别成功',
                  icon: 'success'
                });
              } else {
                wx.showToast({
                  title: '识别失败',
                  icon: 'none'
                });
              }
            } catch (e) {
              console.error(e);
              wx.showToast({
                title: '解析错误',
                icon: 'none'
              });
            }
          },
          fail(err) {
            wx.hideLoading();
            console.error(err);
            wx.showToast({
              title: '上传失败',
              icon: 'none'
            });
          }
        });
      }
    });
  },

  onSystolicInput(e: WechatMiniprogram.Input) {
    this.setData({ systolic: e.detail.value });
  },
  onDiastolicInput(e: WechatMiniprogram.Input) {
    this.setData({ diastolic: e.detail.value });
  },
  onHeartRateInput(e: WechatMiniprogram.Input) {
    this.setData({ heartRate: e.detail.value });
  },
  onNoteInput(e: WechatMiniprogram.Input) {
    this.setData({ note: e.detail.value });
  },

  saveRecord() {
    const { systolic, diastolic, heartRate, date, time, selectedTags, note, ocrLogId } = this.data;

    if (!systolic || !diastolic || !heartRate) {
      wx.showToast({
        title: '请填写完整数据',
        icon: 'none'
      });
      return;
    }

    const sysVal = parseInt(systolic);
    const diaVal = parseInt(diastolic);
    const hrVal = parseInt(heartRate);

    // Validation
    if (sysVal < 70 || sysVal > 260) {
      wx.showToast({ title: '收缩压超出范围 (70-260)', icon: 'none' });
      return;
    }
    if (diaVal < 40 || diaVal > 150) {
      wx.showToast({ title: '舒张压超出范围 (40-150)', icon: 'none' });
      return;
    }
    if (hrVal < 30 || hrVal > 200) {
      wx.showToast({ title: '心率超出范围 (30-200)', icon: 'none' });
      return;
    }

    const record = {
      openid: wx.getStorageSync('openid'),
      systolic: sysVal,
      diastolic: diaVal,
      heartRate: hrVal,
      measuredAt: `${date} ${time}`,
      tags: Object.keys(selectedTags),
      note: note,
      ocrLogId: ocrLogId // Send OCR Log ID if exists
    };

    // Save to server
    request({
      url: '/records',
      method: 'POST',
      data: record
    }).then(() => {
      wx.showToast({
        title: '记录成功',
        icon: 'success',
        duration: 2000,
        success: () => {
          // Reset form or navigate back
          setTimeout(() => {
             wx.switchTab({ url: '/pages/history/history' });
          }, 1500);
        }
      });
    }).catch(err => {
      console.error('Save record failed:', err);
      wx.showToast({
        title: '保存失败',
        icon: 'none'
      });
    });
  }
});
