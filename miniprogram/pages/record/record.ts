import { API_ENDPOINTS } from '../../config';
import { generateIdempotencyKey } from '../../utils/idempotency';
import { isQuotaError, promptQuotaUpgrade } from '../../utils/quota';
import { request } from '../../utils/request';
import { uploadFile } from '../../utils/upload';

interface OCRRecognizeResponse {
  success: boolean;
  data?: {
    systolic?: number;
    diastolic?: number;
    heartRate?: number | null;
    confidence?: number;
    extractionStrategy?: string;
  };
  ocrLogId?: number;
  confidence?: number;
  needsReview?: boolean;
  extractionStrategy?: string;
  message?: string;
}

Page({
  data: {
    date: '',
    time: '',
    tags: ['清晨空腹', '睡前', '运动后', '服药后', '感觉不适', '其他'],
    selectedTags: {} as Record<string, boolean>,
    systolic: 120,
    diastolic: 80,
    heartRate: 75,
    note: '',
    ocrLogId: null as number | null,
    ocrNeedsReview: false,
    ocrConfidence: 0,
    ocrExtractionStrategy: '',
    ocrStatusText: '',
    ocrVerified: false,
    ocrOriginal: null as null | { systolic: number; diastolic: number; heartRate: number },

    bpRange: [[], []] as number[][],
    bpValues: [[], []] as number[][],
    bpIndex: [0, 0],
    hrRange: [] as number[],
    hrIndex: 0,
    networkOffline: false,
    quotaTip: '',
    editingId: 0,
  },

  onShow() {
    const offline = !!wx.getStorageSync('network_offline') && !wx.getStorageSync('token');
    this.setData({ networkOffline: offline });
    this.loadQuotaTip();
    const pendingEdit = Number(wx.getStorageSync('pending_edit_record_id') || 0);
    if (pendingEdit > 0) {
      wx.removeStorageSync('pending_edit_record_id');
      this.loadRecordForEdit(pendingEdit);
    }
  },

  async loadQuotaTip() {
    if (!wx.getStorageSync('token')) return;
    try {
      const res: any = await request({ url: API_ENDPOINTS.USER_INFO, method: 'GET', showError: false });
      const ocrLeft = Math.max(0, (res.ocr_quota || 0) - (res.ocr_used || 0));
      const dataLeft = Math.max(0, (res.data_quota || 0) - (res.data_used || 0));
      const ocrPeriod = res.ocr_quota_period === 'daily' ? '今日' : '本月';
      this.setData({
        quotaTip: `${ocrPeriod} OCR 剩余 ${ocrLeft}/${res.ocr_quota || 0}，今日记录剩余 ${dataLeft}/${res.data_quota || 0}`,
      });
    } catch {
      // ignore
    }
  },

  retryLogin() {
    const app = getApp<IAppOption>();
    if (app && typeof app.doLogin === 'function') {
      app.doLogin();
    }
    setTimeout(() => {
      const offline = !!wx.getStorageSync('network_offline') && !wx.getStorageSync('token');
      this.setData({ networkOffline: offline });
      if (!offline) {
        wx.showToast({ title: '已重新登录', icon: 'success' });
      }
    }, 1500);
  },

  onLoad(options: Record<string, string>) {
    this.initPickers();
    this.checkFirstUse();

    if (options?.activate) {
      wx.setStorageSync('pending_activate', options.activate);
    }
    if (options?.invite) {
      wx.setStorageSync('pending_invite', options.invite);
    }

    const now = new Date();
    const year = now.getFullYear();
    const month = (now.getMonth() + 1).toString().padStart(2, '0');
    const day = now.getDate().toString().padStart(2, '0');
    const hour = now.getHours().toString().padStart(2, '0');
    const minute = now.getMinutes().toString().padStart(2, '0');

    this.setData({
      date: `${year}-${month}-${day}`,
      time: `${hour}:${minute}`,
    });

    const editId = Number(options?.editId || 0);
    if (editId > 0) {
      this.loadRecordForEdit(editId);
    }
  },

  async loadRecordForEdit(id: number) {
    try {
      const res = await request<{ data: any }>({
        url: `${API_ENDPOINTS.RECORDS}/${id}`,
        method: 'GET',
      });
      const item = res.data;
      if (!item) return;
      const measured = new Date(item.measured_at);
      const date = `${measured.getFullYear()}-${(measured.getMonth() + 1).toString().padStart(2, '0')}-${measured.getDate().toString().padStart(2, '0')}`;
      const time = `${measured.getHours().toString().padStart(2, '0')}:${measured.getMinutes().toString().padStart(2, '0')}`;
      let tags: string[] = [];
      try {
        tags = typeof item.tags === 'string' ? JSON.parse(item.tags || '[]') : (item.tags || []);
      } catch {
        tags = [];
      }
      const selectedTags: Record<string, boolean> = {};
      tags.forEach((t) => { selectedTags[t] = true; });
      this.updatePickersFromValues(item.systolic, item.diastolic, item.heart_rate || 75);
      this.setData({
        editingId: id,
        date,
        time,
        note: item.note || '',
        selectedTags,
      });
      wx.setNavigationBarTitle({ title: '编辑记录' });
    } catch (error) {
      console.error('Failed to load record for edit', error);
      wx.showToast({ title: '加载记录失败', icon: 'none' });
    }
  },

  initPickers() {
    const systolicRange = [];
    for (let i = 60; i <= 300; i++) {
      systolicRange.push(i);
    }

    const diastolicRange = [];
    for (let i = 30; i <= 200; i++) {
      diastolicRange.push(i);
    }

    const hrRange = [];
    for (let i = 20; i <= 300; i++) {
      hrRange.push(i);
    }

    this.setData({
      bpRange: [systolicRange, diastolicRange],
      bpValues: [systolicRange, diastolicRange],
      bpIndex: [systolicRange.indexOf(120), diastolicRange.indexOf(80)],
      hrRange,
      hrIndex: hrRange.indexOf(75),
      systolic: 120,
      diastolic: 80,
      heartRate: 75,
    });
  },

  updatePickersFromValues(systolic: number, diastolic: number, heartRate: number) {
    const bpIndex: [number, number] = [
      Math.max(0, this.data.bpValues[0].indexOf(systolic)),
      Math.max(0, this.data.bpValues[1].indexOf(diastolic)),
    ];
    const hrIndex = Math.max(0, this.data.hrRange.indexOf(heartRate));

    this.setData({
      systolic,
      diastolic,
      heartRate,
      bpIndex,
      hrIndex,
    });
  },

  onBPChange(e: WechatMiniprogram.PickerChange) {
    const val = e.detail.value as number[];
    const systolic = this.data.bpValues[0][val[0]];
    const diastolic = this.data.bpValues[1][val[1]];
    this.setData({ bpIndex: val as [number, number], systolic, diastolic });
  },

  onHRChange(e: WechatMiniprogram.PickerChange) {
    const index = e.detail.value as unknown as number;
    this.setData({ hrIndex: index, heartRate: this.data.hrRange[index] });
  },

  addCustomTag() {
    wx.showModal({
      title: '添加标签',
      placeholderText: '请输入标签名称',
      editable: true,
      success: (res) => {
        if (res.confirm && res.content) {
          const newTag = res.content.trim();
          if (newTag && !this.data.tags.includes(newTag)) {
            const newTags = [...this.data.tags];
            const otherIndex = newTags.indexOf('其他');
            if (otherIndex > -1) {
              newTags.splice(otherIndex, 0, newTag);
            } else {
              newTags.push(newTag);
            }
            this.setData({
              tags: newTags,
              selectedTags: { ...this.data.selectedTags, [newTag]: true },
            });
          }
        }
      },
    });
  },

  goToGuide() {
    wx.navigateTo({ url: '/pages/guide/guide' });
  },

  goToMedications() {
    wx.navigateTo({ url: '/pages/medications/index' });
  },

  checkFirstUse() {
    const hasShownGuide = wx.getStorageSync('has_shown_guide');
    if (!hasShownGuide) {
      wx.showModal({
        title: '欢迎使用安压宝',
        content: '本工具仅用于记录和管理血压数据，不提供医疗诊断建议。如有不适，请及时就医。\n\n现在可直接录入血压、拍照识别并在识别后完成核对。',
        showCancel: false,
        confirmText: '我知道了',
        success: () => wx.setStorageSync('has_shown_guide', true),
      });
    }
  },

  bindDateChange(e: WechatMiniprogram.PickerChange) {
    this.setData({ date: e.detail.value as string });
  },

  bindTimeChange(e: WechatMiniprogram.PickerChange) {
    this.setData({ time: e.detail.value as string });
  },

  toggleTag(e: WechatMiniprogram.TouchEvent) {
    const tag = e.currentTarget.dataset.tag as string;
    const selectedTags = { ...this.data.selectedTags };
    if (selectedTags[tag]) {
      delete selectedTags[tag];
    } else {
      selectedTags[tag] = true;
    }
    this.setData({ selectedTags });
  },

  clearOCRState() {
    this.setData({
      ocrLogId: null,
      ocrNeedsReview: false,
      ocrConfidence: 0,
      ocrExtractionStrategy: '',
      ocrStatusText: '',
      ocrVerified: false,
      ocrOriginal: null,
    });
  },

  async submitOcrVerification() {
    if (!this.data.ocrLogId || this.data.ocrVerified) {
      return true;
    }

    const currentValues = {
      systolic: Number(this.data.systolic),
      diastolic: Number(this.data.diastolic),
      heartRate: Number(this.data.heartRate),
    };
    const original = this.data.ocrOriginal;
    const accepted = !!original &&
      original.systolic === currentValues.systolic &&
      original.diastolic === currentValues.diastolic &&
      original.heartRate === currentValues.heartRate;

    try {
      await request({
        url: API_ENDPOINTS.OCR_VERIFY,
        method: 'POST',
        data: {
          ocrLogId: this.data.ocrLogId,
          accepted,
          systolic: accepted ? undefined : currentValues.systolic,
          diastolic: accepted ? undefined : currentValues.diastolic,
          heartRate: accepted ? undefined : currentValues.heartRate,
        },
      });
      this.setData({
        ocrVerified: true,
        ocrStatusText: accepted ? 'OCR 结果已确认' : 'OCR 更正结果已回传',
      });
      return true;
    } catch (error) {
      console.error('Failed to verify OCR result', error);
      return false;
    }
  },

  async confirmOcrResult() {
    const success = await this.submitOcrVerification();
    if (success) {
      wx.showToast({ title: '已确认 OCR 结果', icon: 'success' });
    }
  },

  onOCRScan() {
    wx.chooseMedia({
      count: 1,
      mediaType: ['image'],
      sourceType: ['camera', 'album'],
      sizeType: ['compressed'],
      success: async (res) => {
        const tempFilePath = res.tempFiles[0]?.tempFilePath;
        if (!tempFilePath) return;

        wx.showLoading({ title: '识别中...' });
        try {
          const result = await uploadFile<OCRRecognizeResponse>({
            url: API_ENDPOINTS.OCR_RECOGNIZE,
            filePath: tempFilePath,
            name: 'image',
            showError: false,
          });

          if (!result.success || !result.data) {
            wx.showToast({ title: result.message || '识别失败', icon: 'none' });
            return;
          }

          const systolic = result.data.systolic ?? this.data.systolic;
          const diastolic = result.data.diastolic ?? this.data.diastolic;
          const heartRate = result.data.heartRate ?? this.data.heartRate;

          if (!systolic && !diastolic && !heartRate) {
            wx.showToast({ title: '未能识别有效读数', icon: 'none' });
            return;
          }

          this.updatePickersFromValues(systolic, diastolic, heartRate || this.data.heartRate);
          this.setData({
            ocrLogId: result.ocrLogId || null,
            ocrNeedsReview: !!result.needsReview,
            ocrConfidence: result.confidence || result.data.confidence || 0,
            ocrExtractionStrategy: result.extractionStrategy || result.data.extractionStrategy || '',
            ocrStatusText: result.needsReview ? '识别可信度偏低，请核对下方表单后再保存。' : '识别结果已回填，可直接保存或手动微调。',
            ocrVerified: false,
            ocrOriginal: {
              systolic,
              diastolic,
              heartRate: heartRate || this.data.heartRate,
            },
          });

          if (result.needsReview) {
            wx.showModal({
              title: '请核对 OCR 结果',
              content: '这次识别可信度偏低，建议你确认下方表单数值，确认后再保存。',
              showCancel: false,
            });
          } else {
            wx.showToast({ title: '识别成功', icon: 'success' });
          }
        } catch (error) {
          console.error('OCR scan failed', error);
          if (isQuotaError(error)) {
            promptQuotaUpgrade((error as any)?.message || (error as any)?.data?.message);
          } else {
            wx.showToast({ title: '识别失败，请重试或手动输入', icon: 'none' });
          }
        } finally {
          wx.hideLoading();
        }
      },
    });
  },

  onNoteInput(e: WechatMiniprogram.Input) {
    this.setData({ note: e.detail.value });
  },

  async persistRecord() {
    const sysVal = Number(this.data.systolic);
    const diaVal = Number(this.data.diastolic);
    const hrVal = Number(this.data.heartRate);
    const measuredAt = new Date(`${this.data.date}T${this.data.time}:00`).toISOString();

    if (this.data.ocrLogId && !this.data.ocrVerified) {
      const verified = await this.submitOcrVerification();
      if (!verified) return;
    }

    const payload = {
      systolic: sysVal,
      diastolic: diaVal,
      heartRate: hrVal,
      measuredAt,
      tags: Object.keys(this.data.selectedTags),
      note: this.data.note,
      ocrLogId: this.data.ocrLogId,
    };

    try {
      if (this.data.editingId) {
        await request({
          url: `${API_ENDPOINTS.RECORDS}/${this.data.editingId}`,
          method: 'PUT',
          data: payload,
        });
      } else {
        await request({
          url: API_ENDPOINTS.RECORDS,
          method: 'POST',
          idempotencyKey: generateIdempotencyKey('record'),
          data: payload,
        });
      }
    } catch (error) {
      if (!this.data.editingId && isQuotaError(error)) {
        promptQuotaUpgrade((error as any)?.message || (error as any)?.data?.error);
      }
      throw error;
    }

    wx.showToast({
      title: this.data.editingId ? '已更新' : '记录成功',
      icon: 'success',
      duration: 1800,
    });
    this.clearOCRState();
    setTimeout(() => {
      if (this.data.editingId) {
        wx.navigateBack({ fail: () => wx.switchTab({ url: '/pages/trend/trend' }) });
      } else {
        wx.switchTab({ url: '/pages/trend/trend' });
      }
    }, 1200);
  },

  saveRecord() {
    const sysVal = Number(this.data.systolic);
    const diaVal = Number(this.data.diastolic);
    const hrVal = Number(this.data.heartRate);

    if (!sysVal || !diaVal || !hrVal) {
      wx.showToast({ title: '请填写完整数据', icon: 'none' });
      return;
    }
    if (sysVal < 60 || sysVal > 300) {
      wx.showToast({ title: '收缩压范围应为 60-300', icon: 'none' });
      return;
    }
    if (diaVal < 30 || diaVal > 200) {
      wx.showToast({ title: '舒张压范围应为 30-200', icon: 'none' });
      return;
    }
    if (sysVal <= diaVal) {
      wx.showToast({ title: '收缩压应大于舒张压', icon: 'none' });
      return;
    }
    if (hrVal < 20 || hrVal > 300) {
      wx.showToast({ title: '心率范围应为 20-300', icon: 'none' });
      return;
    }

    if (this.data.ocrLogId && this.data.ocrNeedsReview && !this.data.ocrVerified) {
      wx.showModal({
        title: '确认 OCR 结果',
        content: '当前 OCR 可信度偏低。请确认你已经核对表单中的血压和心率数值，再继续保存。',
        success: async (res) => {
          if (!res.confirm) return;
          try {
            await this.persistRecord();
          } catch (error) {
            console.error('Save record failed:', error);
          }
        },
      });
      return;
    }

    this.persistRecord().catch((error) => {
      console.error('Save record failed:', error);
    });
  },
});
